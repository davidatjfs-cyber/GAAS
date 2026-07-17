"""隔离库验收：合同审批→品牌授信→订单→财务销账/退回→逐订单开通。"""
import os, time, requests

BASE=os.environ.get('TEST_BASE_URL','http://127.0.0.1:3302')
s=requests.Session(); s.trust_env=False
def call(path, method='GET', body=None, token=None, expected=200):
  h={'Content-Type':'application/json'}
  if token: h['Authorization']=f'Bearer {token}'
  r=s.request(method,BASE+path,json=body,headers=h,timeout=20); data=r.json() if r.content else {}
  assert r.status_code==expected,(path,r.status_code,data); return data
time.sleep(2)
s.post(BASE+'/api/admin/auth/bootstrap',json={'username':'root','password':'Passw0rd!','real_name':'Root'},headers={'x-platform-admin-secret':'e2e-bootstrap-secret'},timeout=20)
root=call('/api/admin/auth/login','POST',{'username':'root','password':'Passw0rd!'})['token']
for u,role in [('seller','sales'),('gm','general_manager'),('fin','finance')]:
  call('/api/admin/auth/accounts','POST',{'username':u,'password':'Passw0rd!','real_name':u,'role':role},root,expected=200)
seller=call('/api/admin/auth/login','POST',{'username':'seller','password':'Passw0rd!'})['token']; gm=call('/api/admin/auth/login','POST',{'username':'gm','password':'Passw0rd!'})['token']; fin=call('/api/admin/auth/login','POST',{'username':'fin','password':'Passw0rd!'})['token']
lead=call('/api/admin/sales/customers','POST',{
  'company':'年年连锁品牌','name':'张总','contact_title':'联合创始人','phone':'13800138000','customer_origin':'sales_visit',
  'customer_brands':[{'brand_name':'年年连锁','city':'上海','store_count':2},{'brand_name':'年年副牌','city':'杭州','store_count':1}],
  'requested_payment_type':'credit','requested_credit_days':30,'requested_credit_limit':25000,
},seller,201)['customer']
assert lead['customer_brands'][0]['brand_name']=='年年连锁' and lead['legal_contact_title']=='联合创始人'
edited=call(f"/api/admin/sales/leads/{lead['id']}/dossier",'PUT',{'customer_contacts':[{'name':'张总','title':'联合创始人','phone':'13800138000'},{'name':'王总','title':'财务总监','phone':'13700137000'}]},seller)['lead']
assert len(edited['customer_contacts'])==2
visit=call(f"/api/admin/sales/leads/{lead['id']}/visits",'POST',{'visit_type':'onsite','notes':'确认上海与杭州门店分批上线，并由财务总监复核付款与帐期。','next_followup_plan':'发送合同','next_followup_at':'2026-08-01T10:00:00+08:00'},seller)['visit']
assert visit['notes'].startswith('确认上海')
contract=call(f"/api/admin/sales/leads/{lead['id']}/contracts",'POST',{'contract_no':'E2E-ORDER-1','amount':10000,'file_url':'/uploads/e2e.pdf','file_name':'e2e.pdf'},seller)['contract']
call(f"/api/admin/sales/contracts/{contract['id']}/submit-approval",'POST',{},seller)
approved=call(f"/api/admin/sales/contracts/{contract['id']}/approve",'POST',{'payment_type':'credit','brand_name':'年年连锁','credit_limit':25000},gm)['contract']; assert approved['approval_status']=='approved'
order=call(f"/api/admin/sales/leads/{lead['id']}/orders",'POST',{'contract_id':contract['id'],'order_type':'new_store','amount':10000,'license_days':30,'store_name':'年年连锁一店','brand_name':'年年连锁','store_address':'上海','contact_name':'张总','contact_phone':'13800138000'},seller,201)['order']
done=call(f"/api/admin/sales/orders/{order['id']}/finance-decision",'POST',{'action':'approve_credit'},fin); assert done['provision']['ok'] and done['provision']['tenant_id']; tenant_id=done['provision']['tenant_id']
second=call(f"/api/admin/sales/leads/{lead['id']}/orders",'POST',{'contract_id':contract['id'],'order_type':'new_store','amount':6000,'license_days':90,'store_name':'年年副牌一店','brand_name':'年年副牌','store_address':'杭州'},seller,201)['order']
second_done=call(f"/api/admin/sales/orders/{second['id']}/finance-decision",'POST',{'action':'approve_credit'},fin); assert second_done['provision']['ok'] and second_done['provision']['tenant_id']==tenant_id
third=call(f"/api/admin/sales/leads/{lead['id']}/orders",'POST',{'contract_id':contract['id'],'order_type':'new_store','amount':10000,'store_name':'年年连锁二店','brand_name':'年年连锁'},seller,201)['order']
r=s.post(BASE+f"/api/admin/sales/orders/{third['id']}/finance-decision",json={'action':'approve_credit'},headers={'Authorization':'Bearer '+fin}); assert r.status_code==409 and r.json()['error']=='credit_limit_exceeded'
cashlead=call('/api/admin/sales/customers','POST',{'company':'现金客户','name':'李总','contact_title':'老板','phone':'13900139000','customer_origin':'sales_visit','customer_brands':[{'brand_name':'现金客户','city':'北京','store_count':1}]},seller,201)['customer']
cashc=call(f"/api/admin/sales/leads/{cashlead['id']}/contracts",'POST',{'contract_no':'E2E-CASH-1','amount':3000,'file_url':'/uploads/cash.pdf'},seller)['contract']; call(f"/api/admin/sales/contracts/{cashc['id']}/submit-approval",'POST',{},seller); call(f"/api/admin/sales/contracts/{cashc['id']}/approve",'POST',{'payment_type':'cash','brand_name':'现金客户'},gm)
casho=call(f"/api/admin/sales/leads/{cashlead['id']}/orders",'POST',{'contract_id':cashc['id'],'order_type':'new_store','amount':3000,'store_name':'现金客户一店'},seller,201)['order']; paid=call(f"/api/admin/sales/orders/{casho['id']}/finance-decision",'POST',{'action':'confirm_paid','amount':3000},fin); assert paid['provision']['ok']
print('sales order approval/credit/payment closure e2e passed')
