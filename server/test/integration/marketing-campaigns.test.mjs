import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

// P1覆盖：营销活动(campaigns)的增删改查，涉及门店实际投放的营销预算/优惠券
// 相关活动，是差距评估里标为P1的高价值模块（直接涉及资金/优惠券投放）。

let app;

async function createAdmin(tenantId = 'default') {
  const db = testDb();
  const username = uniqueId('mktadmin');
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', 'admin', true, $3)`,
    [username, hash, tenantId]
  );
  return username;
}

async function login(username) {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Pass12345' })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.token;
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('创建营销活动：写入必填字段，budget/target_count正确转数字', async () => {
  const admin = await createAdmin();
  const token = await login(admin);

  const res = await fetch(app.baseUrl + '/api/customer-ops/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      title: '国庆满减活动',
      channel: 'wecom',
      campaign_type: '满减券',
      budget: 5000,
      target_count: 200
    })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.campaign.title, '国庆满减活动');
  assert.equal(Number(body.campaign.budget), 5000);
  assert.equal(Number(body.campaign.target_count), 200);
});

test('创建营销活动：缺少title应该被拒绝', async () => {
  const admin = await createAdmin();
  const token = await login(admin);

  const res = await fetch(app.baseUrl + '/api/customer-ops/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ channel: 'wecom', budget: 1000 })
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'title_required');
});

test('修改/删除营销活动：不能跨租户操作别的租户的活动', async () => {
  const db = testDb();
  const otherTenant = uniqueId('other_tenant');
  await db.query(
    `insert into tenants (tenant_id, name, status) values ($1, '其他租户', 'active')`,
    [otherTenant]
  );

  const adminOther = await createAdmin(otherTenant);
  const tokenOther = await login(adminOther);
  const createRes = await fetch(app.baseUrl + '/api/customer-ops/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenOther },
    body: JSON.stringify({ title: '其他租户的活动' })
  });
  const createBody = await createRes.json();
  assert.equal(createRes.status, 200, JSON.stringify(createBody));
  const campaignId = createBody.campaign.id;

  // default租户的admin尝试修改/删除别的租户的活动
  const adminDefault = await createAdmin('default');
  const tokenDefault = await login(adminDefault);

  const updateRes = await fetch(app.baseUrl + `/api/customer-ops/campaigns/${campaignId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenDefault },
    body: JSON.stringify({ title: '篡改标题' })
  });
  const updateBody = await updateRes.json();
  assert.equal(updateRes.status, 404, '跨租户修改应该被当成"不存在"拒绝: ' + JSON.stringify(updateBody));

  const deleteRes = await fetch(app.baseUrl + `/api/customer-ops/campaigns/${campaignId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + tokenDefault }
  });
  assert.equal(deleteRes.status, 200); // delete接口本身不因0行受影响而报错

  const stillThere = await db.query(`select title from marketing_campaigns where id = $1`, [campaignId]);
  assert.equal(stillThere.rows.length, 1, '别的租户的活动不应该被跨租户删除');
  assert.equal(stillThere.rows[0].title, '其他租户的活动');
});
