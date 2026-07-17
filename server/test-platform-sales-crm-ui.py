import json
import os
import time
import requests
from playwright.sync_api import sync_playwright

BASE = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:3300")
SESSION = requests.Session()
SESSION.trust_env = False
time.sleep(2)


def call(path, method="GET", body=None, token=None, expected=200):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for attempt in range(10):
        try:
            resp = SESSION.request(method, BASE + path, json=body, headers=headers, timeout=20)
            status = resp.status_code
            payload = resp.json() if resp.content else {}
            break
        except requests.ConnectionError:
            if attempt == 9:
                raise
            time.sleep(0.5)
    expected_statuses = expected if isinstance(expected, tuple) else (expected,)
    assert status in expected_statuses, (path, status, payload)
    return payload


call("/api/admin/auth/bootstrap", "POST", {
    "username": "e2e_super", "password": "E2ePassw0rd!", "real_name": "E2E超级管理员"
}, expected=401)

# bootstrap requires its one-time server secret.
for attempt in range(10):
    try:
        resp = SESSION.post(BASE + "/api/admin/auth/bootstrap", json={"username": "e2e_super", "password": "E2ePassw0rd!", "real_name": "E2E超级管理员"}, headers={"x-platform-admin-secret": "e2e-bootstrap-secret"}, timeout=20)
        assert resp.status_code in (200, 403), (resp.status_code, resp.text)
        break
    except requests.ConnectionError:
        if attempt == 9:
            raise
        time.sleep(0.5)

super_login = call("/api/admin/auth/login", "POST", {"username": "e2e_super", "password": "E2ePassw0rd!"})
super_token = super_login["token"]
uploaded_paths = []
doc_upload = SESSION.post(BASE + "/api/admin/sales/documents/upload", headers={"Authorization": f"Bearer {super_token}"}, files={"file": ("contract.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")}, timeout=20)
assert doc_upload.status_code == 200, doc_upload.text
doc_data = doc_upload.json()
assert doc_data["file_url"].startswith("/uploads/")
uploaded_paths.append(doc_data["file_url"])
qr_upload = SESSION.post(BASE + "/api/admin/sales/content-assets/upload", headers={"Authorization": f"Bearer {super_token}"}, files={"file": ("consultant.png", b"not-a-real-image", "image/png")}, timeout=20)
assert qr_upload.status_code == 200, qr_upload.text
qr_data = qr_upload.json()
uploaded_paths.append(qr_data["media_url"])
qr_asset = call("/api/admin/sales/content-assets", "POST", {
    "asset_key": "e2e_consultant_qr", "title": "E2E销售企微二维码", "content_type": "qr",
    "media_url": qr_data["media_url"], "external_approved": True, "auto_send_allowed": False
}, super_token)
assert qr_asset["asset"]["content_type"] == "qr"
for username, role, name in [
    ("e2e_sales", "sales", "E2E销售"),
    ("e2e_finance", "finance", "E2E财务"),
    ("e2e_gm", "general_manager", "E2E总经理"),
    ("e2e_cs", "customer_service", "E2E客服"),
    ("e2e_impl", "implementation", "E2E实施"),
]:
    result = call("/api/admin/auth/accounts", "POST", {
        "username": username, "password": "E2ePassw0rd!", "real_name": name, "role": role
    }, super_token, expected=(200, 409))
    assert result.get("ok") or result.get("error") == "username_taken"

call("/api/admin/sales/regions", "POST", {"region_code": "east_china", "region_name": "华东区"}, super_token)
call("/api/admin/sales/reps", "POST", {
    "rep_key": "e2e_sales", "display_name": "E2E销售", "role": "sales",
    "region_code": "east_china", "region_name": "华东区", "wecom_qr_asset_id": qr_asset["asset"]["id"]
}, super_token)

sandbox = call("/api/admin/sales/sandbox/chat", "POST", {
    "external_userid": "e2e_crm_customer", "text": "我是测试餐饮公司，有三家门店，想了解系统。"
}, super_token)
lead_id = sandbox["lead_id"]
call(f"/api/admin/sales/leads/{lead_id}/assign", "POST", {"username": "e2e_sales"}, super_token)

sales_login = call("/api/admin/auth/login", "POST", {"username": "e2e_sales", "password": "E2ePassw0rd!"})
sales_token = sales_login["token"]
call(f"/api/admin/sales/leads/{lead_id}/dossier", "PUT", {"region_code": "east_china", "region_name": "华东区", "city": "上海"}, sales_token)
leads = call("/api/admin/sales/leads?limit=20", token=sales_token)
assert any(int(x["id"]) == int(lead_id) for x in leads["leads"])
call("/api/admin/tenants", token=sales_token, expected=403)

overview = call(f"/api/admin/sales/leads/{lead_id}/crm-overview", token=sales_token)
contract = (overview.get("contracts") or [None])[0]
if not contract:
    contract = call(f"/api/admin/sales/leads/{lead_id}/contracts", "POST", {
        "contract_no": f"E2E-{lead_id}", "amount": 1000
    }, sales_token)["contract"]
contract_id = contract["id"]
if not contract.get("customer_signed_at"):
    call(f"/api/admin/sales/contracts/{contract_id}/status", "PATCH", {"status": "customer_signed"}, sales_token)
call(f"/api/admin/sales/contracts/{contract_id}/status", "PATCH", {"status": "our_signed"}, sales_token, expected=403)

gm_token = call("/api/admin/auth/login", "POST", {"username": "e2e_gm", "password": "E2ePassw0rd!"})["token"]
call(f"/api/admin/sales/leads/{lead_id}/credit-risk", "PUT", {
    "payment_type": "cash", "credit_limit": 0
}, gm_token)
if not contract.get("our_signed_at"):
    call(f"/api/admin/sales/contracts/{contract_id}/status", "PATCH", {"status": "our_signed"}, gm_token)
effective = call(f"/api/admin/sales/contracts/{contract_id}/status", "PATCH", {"status": "effective"}, gm_token)
assert effective["credit_risk"]["can_provision"] is False
locked = call(f"/api/admin/sales/leads/{lead_id}/credit-risk", "PUT", {
    "payment_type": "credit", "credit_limit": 500
}, gm_token)
assert locked["risk"]["exceeded"] is True and locked["risk"]["status"] == "locked"
unlocked = call(f"/api/admin/sales/leads/{lead_id}/credit-risk", "PUT", {
    "payment_type": "credit", "credit_limit": 2000
}, gm_token)
assert unlocked["risk"]["can_provision"] is True
assert unlocked["provision"] and unlocked["provision"]["ok"] is True
assert unlocked["provision"].get("temp_password") is None

cs_token = call("/api/admin/auth/login", "POST", {"username": "e2e_cs", "password": "E2ePassw0rd!"})["token"]
delivery_overview = call(f"/api/admin/sales/leads/{lead_id}/crm-overview", token=cs_token)
assert delivery_overview["delivery"] and delivery_overview["delivery"]["cs_owner"] == "e2e_cs"
delivered = None
for delivery_status in ["assigned", "data_import", "diagnosis", "configuration", "acceptance", "delivered"]:
    delivered = call(f"/api/admin/sales/leads/{lead_id}/delivery", "PUT", {"status": delivery_status}, cs_token)
assert delivered["credentials"] and delivered["credentials"]["ok"] is True
repeat_delivery = call(f"/api/admin/sales/leads/{lead_id}/delivery", "PUT", {"status": "delivered"}, cs_token)
assert repeat_delivery["credentials"] is None

payment = call(f"/api/admin/sales/contracts/{contract_id}/payments", "POST", {"amount": 100}, sales_token)["payment"]
invoice = call(f"/api/admin/sales/contracts/{contract_id}/invoices", "POST", {"amount": 200}, sales_token)["invoice"]
finance_token = call("/api/admin/auth/login", "POST", {"username": "e2e_finance", "password": "E2ePassw0rd!"})["token"]
assert any(int(x["id"]) == int(payment["id"]) for x in call("/api/admin/sales/finance/pending-payments", token=finance_token)["items"])
assert any(int(x["id"]) == int(invoice["id"]) for x in call("/api/admin/sales/finance/pending-invoices", token=finance_token)["items"])
call(f"/api/admin/sales/payments/{payment['id']}/confirm", "POST", {}, finance_token)
call(f"/api/admin/sales/invoices/{invoice['id']}/issued", "PATCH", {"invoice_no": f"INV-{invoice['id']}"}, finance_token)
region_performance = call("/api/admin/sales/performance/by-region", token=gm_token)["regions"]
east = next(x for x in region_performance if x["region_code"] == "east_china")
assert east["lead_count"] >= 1 and int(east["paid_fen"]) >= 10000
call(f"/api/admin/sales/contracts/{contract_id}/payments", "POST", {"amount": 50}, sales_token)
call(f"/api/admin/sales/contracts/{contract_id}/invoices", "POST", {"amount": 50}, sales_token)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-proxy-server"])
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE + "/sales-crm")
    page.wait_for_load_state("networkidle")
    page.fill("#loginUsername", "e2e_sales")
    page.fill("#loginPassword", "E2ePassw0rd!")
    page.click("#loginBtn")
    page.wait_for_function("() => !!localStorage.getItem('platform_admin_token')")
    page.wait_for_selector("#panel-sales.active")
    page.wait_for_load_state("networkidle")
    assert page.locator('#topTabs button[data-panel="tenants"]').is_hidden()
    assert page.locator('#topTabs button[data-panel="create"]').is_hidden()
    assert page.locator('#topTabs button[data-panel="config"]').is_hidden()
    page.locator(f'tr[data-lead-id="{lead_id}"]').click()
    page.wait_for_selector("#salesDetailCard", state="visible")
    page.wait_for_selector("#salesContractsBox [data-contract-id]")
    assert page.locator("#salesContractFile").count() == 1
    assert page.locator("#salesContractsBox [data-payment-amount]").count() == 1
    assert page.locator("#salesContractsBox [data-invoice-amount]").count() == 1
    page.screenshot(path="/tmp/gaas-sales-crm-e2e.png", full_page=True)
    assert not errors, errors
    browser.close()

    finance_browser = p.chromium.launch(headless=True, args=["--no-proxy-server"])
    finance_page = finance_browser.new_page(viewport={"width": 1280, "height": 900})
    finance_page.goto(BASE + "/sales-crm")
    finance_page.wait_for_load_state("networkidle")
    finance_page.fill("#loginUsername", "e2e_finance")
    finance_page.fill("#loginPassword", "E2ePassw0rd!")
    finance_page.click("#loginBtn")
    finance_page.wait_for_selector("#salesFinanceBox", state="visible")
    assert finance_page.locator("#workspaceTitle").inner_text() == "上海年年有喜销售 CRM"
    assert "财务待办" in finance_page.locator("#salesFinanceBox").inner_text()
    assert finance_page.locator('#topTabs button[data-panel="tenants"]').is_hidden()
    finance_page.screenshot(path="/tmp/gaas-sales-crm-finance-e2e.png", full_page=True)
    finance_browser.close()

print(f"platform sales CRM UI/API e2e passed lead={lead_id} contract={contract_id}")
for uploaded_path in uploaded_paths:
    try:
        os.remove(os.path.join(os.path.dirname(__file__), "uploads", os.path.basename(uploaded_path)))
    except FileNotFoundError:
        pass
