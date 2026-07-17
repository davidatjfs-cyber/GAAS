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
internal_asset = call("/api/admin/sales/content-assets", "POST", {
    "asset_key": "e2e_internal_sales_playbook", "title": "E2E内部销售策略", "content_type": "text",
    "text_content": "仅供销售AI使用", "knowledge_domain": "sales_ai", "version_no": 2,
    "customer_types": ["连锁餐饮"], "external_approved": False, "auto_send_allowed": False
}, super_token)["asset"]
assert internal_asset["knowledge_domain"] == "sales_ai" and internal_asset["version_no"] == 2
call("/api/admin/sales/content-assets", "POST", {
    "asset_key": "e2e_internal_leak", "title": "不得外发", "content_type": "text",
    "text_content": "内部资料", "knowledge_domain": "sales_ai", "external_approved": True
}, super_token, expected=400)
for username, role, name in [
    ("e2e_sales", "sales", "E2E销售"),
    ("e2e_finance", "finance", "E2E财务"),
    ("e2e_gm", "general_manager", "E2E总经理"),
    ("e2e_cs", "customer_service", "E2E客服"),
    ("e2e_impl", "implementation", "E2E实施"),
    ("e2e_auditor", "auditor", "E2E只读审计"),
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
manual_customer = call("/api/admin/sales/customers", "POST", {
    "company": "E2E销售拜访餐饮管理有限公司", "name": "王店长", "phone": "13900001234",
    "city": "上海", "store_count": 4, "customer_origin": "sales_visit",
    "first_visit_notes": "首次上门拜访，客户希望提升会员复购并安排下周系统演示。",
    "next_action": "下周发送方案并预约演示"
}, sales_token, expected=201)["customer"]
assert manual_customer["customer_origin"] == "sales_visit" and manual_customer["customer_code"]
duplicate_manual = call("/api/admin/sales/customers", "POST", {
    "company": "E2E销售拜访餐饮管理有限公司", "name": "王店长", "phone": "13900001234", "city": "上海"
}, sales_token, expected=409)
assert duplicate_manual["error"] == "customer_exists" and int(duplicate_manual["existing"]["id"]) == int(manual_customer["id"])
sales_assets = call("/api/admin/sales/content-assets", token=sales_token)["items"]
assert all((x.get("knowledge_domain") or "customer_ai") == "customer_ai" for x in sales_assets)
call(f"/api/admin/sales/leads/{lead_id}/dossier", "PUT", {"region_code": "east_china", "region_name": "华东区", "city": "上海"}, sales_token)
leads = call("/api/admin/sales/leads?limit=20", token=sales_token)
assert any(int(x["id"]) == int(lead_id) for x in leads["leads"])
call("/api/admin/tenants", token=sales_token, expected=403)

overview = call(f"/api/admin/sales/leads/{lead_id}/crm-overview", token=sales_token)
contract = (overview.get("contracts") or [None])[0]
if not contract:
    contract = call(f"/api/admin/sales/leads/{lead_id}/contracts", "POST", {
        "contract_no": f"E2E-{lead_id}", "amount": 1000, "version_no": 2
    }, sales_token)["contract"]
assert int(contract.get("version_no") or 1) >= 1
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
call("/api/admin/sales/customers", "POST", {"company": "不应由客服创建", "name": "测试"}, cs_token, expected=403)
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

loss_lead = call("/api/admin/sales/sandbox/chat", "POST", {
    "external_userid": "e2e_loss_customer", "text": "我们暂时不考虑采购，明年再联系。"
}, super_token)["lead_id"]
call("/api/admin/sales/loss-reasons", "POST", {
    "lead_id": loss_lead, "reason_key": "timing", "detail": "太短",
    "budget_status": "无预算", "current_system": "仅POS"
}, super_token, expected=400)
recontact = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 86400))
loss = call("/api/admin/sales/loss-reasons", "POST", {
    "lead_id": loss_lead, "reason_key": "timing", "detail": "客户本年度预算已经锁定，计划明年重新评估。",
    "competitor": "无", "budget_status": "本年度无预算", "current_system": "仅使用POS",
    "recontact_at": recontact, "enter_nurture": True
}, super_token)["loss"]
assert loss["enter_nurture"] is True and loss["recontact_at"]
call(f"/api/admin/sales/sandbox/chat", "POST", {
    "external_userid": "e2e_loss_customer", "text": "资料我看到了，有问题再联系。"
}, super_token)
loss_state = call(f"/api/admin/sales/leads/{loss_lead}", token=super_token)["lead"]
assert loss_state["auto_nurture_enabled"] is False and loss_state["auto_nurture_paused_at"]

auditor_token = call("/api/admin/auth/login", "POST", {"username": "e2e_auditor", "password": "E2ePassw0rd!"})["token"]
call("/api/admin/sales/leads?limit=20", token=auditor_token)
call("/api/admin/auth/audit-log?limit=10", token=auditor_token)
call("/api/admin/tenants", token=auditor_token, expected=403)
call(f"/api/admin/sales/leads/{loss_lead}/auto-nurture", "PUT", {"enabled": True}, auditor_token, expected=403)

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
    assert page.locator('#topTabs button[data-panel="sales"]').inner_text() == "销售 CRM"
    assert page.locator("#panel-sales").get_by_text("客户成交与交付中心", exact=True).count() == 1
    assert page.locator("#salesCreateCustomerBtn").inner_text() == "新建客户档案"
    assert page.locator("#salesCrmNav").get_by_text("客户管理", exact=True).count() == 1
    assert page.locator("#salesCrmNav").get_by_text("合同回款", exact=True).count() == 1
    assert page.locator("#salesCrmNav").get_by_text("内容培育", exact=True).count() == 1
    assert page.locator("#crmCustomersSection").get_by_text("我的客户", exact=True).count() == 1
    assert page.locator("#crmFinanceSection").get_by_text("合同、回款与开票", exact=True).count() == 1
    assert page.locator("#crmContentSection").get_by_text("客户 AI 内容与培育", exact=True).count() == 1
    assert page.locator("#crmPerformanceSection").get_by_text("区域与销售业绩", exact=True).count() == 1
    page.wait_for_function("() => Number(document.querySelector('#crmKpiTotal')?.textContent || 0) >= 1")
    assert int(page.locator("#crmKpiTotal").inner_text()) >= 1
    assert page.locator(f'tr[data-lead-id="{manual_customer["id"]}"]').count() == 1
    assert page.locator('#topTabs button[data-panel="tenants"]').is_hidden()
    assert page.locator('#topTabs button[data-panel="create"]').is_hidden()
    assert page.locator('#topTabs button[data-panel="config"]').is_hidden()
    page.click("#salesCreateCustomerBtn")
    page.wait_for_selector("#salesManualCustomerFormCard", state="visible")
    page.fill("#manualCustomerCompany", "E2E界面自主建档客户")
    page.fill("#manualCustomerName", "李店长")
    page.fill("#manualCustomerVisitNotes", "销售上门完成首访，客户确认下周安排经营系统演示。")
    page.click("#salesManualCustomerSaveBtn")
    page.wait_for_selector("#salesDetailCard", state="visible")
    assert "E2E界面自主建档客户" in page.locator("#salesDetailTitle").inner_text()
    assert "销售上门拜访" in page.locator("#salesDossierBox").inner_text()
    page.click("#salesDetailCloseBtn")
    page.locator(f'tr[data-lead-id="{lead_id}"]').click()
    page.wait_for_selector("#salesDetailCard", state="visible")
    page.wait_for_selector("#salesContractsBox [data-contract-id]")
    assert page.locator("#salesContractFile").count() == 1
    assert page.locator("#salesContractsBox [data-payment-amount]").count() == 1
    assert page.locator("#salesContractsBox [data-invoice-amount]").count() == 1
    assert "第2版" in page.locator("#salesContractsBox").inner_text()
    page.click("#salesLostBtn")
    page.wait_for_selector("#salesLossReviewBox", state="visible")
    assert page.locator("#salesLossBudget").count() == 1
    assert page.locator("#salesLossCurrentSystem").count() == 1
    assert page.locator("#salesLossRecontactAt").count() == 1
    page.click("#salesLossCancelBtn")
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

    cs_browser = p.chromium.launch(headless=True, args=["--no-proxy-server"])
    cs_page = cs_browser.new_page(viewport={"width": 1280, "height": 900})
    cs_page.goto(BASE + "/sales-crm")
    cs_page.wait_for_load_state("networkidle")
    cs_page.fill("#loginUsername", "e2e_cs")
    cs_page.fill("#loginPassword", "E2ePassw0rd!")
    cs_page.click("#loginBtn")
    cs_page.wait_for_selector("#panel-sales.active")
    cs_page.wait_for_function("() => document.querySelector('#crmCustomersSection')?.innerText.includes('待交付客户')")
    assert "待交付客户" in cs_page.locator("#crmCustomersSection").inner_text()
    assert cs_page.locator("#salesCreateCustomerBtn").is_hidden()
    assert cs_page.locator("#crmTodaySection").is_hidden()
    assert "客服 / 实施岗位" in cs_page.locator("#salesRoleGuide").inner_text()
    cs_page.screenshot(path="/tmp/gaas-sales-crm-delivery-e2e.png", full_page=True)
    cs_browser.close()

    mobile_browser = p.chromium.launch(headless=True, args=["--no-proxy-server"])
    mobile_page = mobile_browser.new_page(viewport={"width": 390, "height": 844})
    mobile_page.goto(BASE + "/platform-admin/")
    mobile_page.wait_for_load_state("networkidle")
    mobile_page.fill("#loginUsername", "e2e_super")
    mobile_page.fill("#loginPassword", "E2ePassw0rd!")
    mobile_page.click("#loginBtn")
    mobile_page.wait_for_function("() => !!localStorage.getItem('platform_admin_token')")
    # 窄屏下顶部标签会折叠，直接调用与标签相同的切换入口验证 CRM 的实际移动端状态。
    mobile_page.evaluate("switchPanel('sales')")
    mobile_page.wait_for_selector("#panel-sales.active")
    assert mobile_page.locator("#selectedTenantBar").is_hidden()
    assert "wkAc" not in mobile_page.locator("#panel-sales .crm-hero").inner_text()
    mobile_page.screenshot(path="/tmp/gaas-sales-crm-mobile-e2e.png", full_page=True)
    mobile_browser.close()

print(f"platform sales CRM UI/API e2e passed lead={lead_id} contract={contract_id}")
for uploaded_path in uploaded_paths:
    try:
        os.remove(os.path.join(os.path.dirname(__file__), "uploads", os.path.basename(uploaded_path)))
    except FileNotFoundError:
        pass
