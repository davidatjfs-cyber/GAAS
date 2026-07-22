import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant, appendStateEmployee } from './helpers/db.mjs';

// 阶段B验证：GET /api/approvals(列表)、GET /api/approvals/:id(详情)、
// DELETE /api/approvals/:id、PUT /api/approval-flows 这几个刚从index.js
// 搬到approval-routes.js的路由，之前没有测试直接覆盖过——之前跑绿的32个
// 测试只碰了POST创建/decide(还留在index.js里)，没有一个碰到这几个被移动
// 的接口，不能证明搬家本身是对的。这里补上，让重构真正被测试验证到。

let app;

async function createUser(role) {
  const db = testDb();
  const username = uniqueId('u');
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', $3, true, 'default')`,
    [username, hash, role]
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

async function createLeaveApproval(applicantToken) {
  const res = await fetch(app.baseUrl + '/api/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + applicantToken },
    body: JSON.stringify({ type: 'leave', payload: { startDate: '2026-09-01', endDate: '2026-09-02' } })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.item.id;
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('GET /api/approvals 列表：admin能看到刚创建的审批单', async () => {
  const admin = await createUser('admin');
  const manager = await createUser('hq_manager');
  const applicant = await createUser('store_employee');
  await appendStateEmployee('default', { username: applicant, role: 'store_employee', store: '测试门店', managerUsername: manager });

  const applicantToken = await login(applicant);
  const approvalId = await createLeaveApproval(applicantToken);

  const adminToken = await login(admin);
  const res = await fetch(app.baseUrl + '/api/approvals?view=all', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const ids = body.items.map((i) => i.id);
  assert.ok(ids.includes(approvalId), '刚创建的审批单应该出现在列表里');
});

test('GET /api/approvals/:id 详情：申请人自己能看到，无关的人看不到', async () => {
  const manager = await createUser('hq_manager');
  const applicant = await createUser('store_employee');
  const outsider = await createUser('store_employee');
  await appendStateEmployee('default', { username: applicant, role: 'store_employee', store: '测试门店', managerUsername: manager });

  const applicantToken = await login(applicant);
  const approvalId = await createLeaveApproval(applicantToken);

  const selfRes = await fetch(app.baseUrl + `/api/approvals/${approvalId}`, {
    headers: { Authorization: 'Bearer ' + applicantToken }
  });
  const selfBody = await selfRes.json();
  assert.equal(selfRes.status, 200, JSON.stringify(selfBody));
  assert.equal(selfBody.item.id, approvalId);

  const outsiderToken = await login(outsider);
  const outsiderRes = await fetch(app.baseUrl + `/api/approvals/${approvalId}`, {
    headers: { Authorization: 'Bearer ' + outsiderToken }
  });
  assert.equal(outsiderRes.status, 403, '无关的人不应该能看到别人的审批详情');
});

test('DELETE /api/approvals/:id: 只有admin能删除，删除后确实从数据库消失', async () => {
  const db = testDb();
  const manager = await createUser('hq_manager');
  const applicant = await createUser('store_employee');
  const nonAdmin = await createUser('hq_manager');
  await appendStateEmployee('default', { username: applicant, role: 'store_employee', store: '测试门店', managerUsername: manager });

  const applicantToken = await login(applicant);
  const approvalId = await createLeaveApproval(applicantToken);

  const nonAdminToken = await login(nonAdmin);
  const forbiddenRes = await fetch(app.baseUrl + `/api/approvals/${approvalId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + nonAdminToken }
  });
  assert.equal(forbiddenRes.status, 403, '非admin不能删除审批单');

  const admin = await createUser('admin');
  const adminToken = await login(admin);
  const okRes = await fetch(app.baseUrl + `/api/approvals/${approvalId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const okBody = await okRes.json();
  assert.equal(okRes.status, 200, JSON.stringify(okBody));

  const row = await db.query(`select 1 from approval_requests where id = $1`, [approvalId]);
  assert.equal(row.rows.length, 0, '删除后数据库里不应该还有这条记录');
});

test('PUT /api/approval-flows: 只有admin能配置，配置正确写入hrms_state', async () => {
  const nonAdmin = await createUser('hq_manager');
  const nonAdminToken = await login(nonAdmin);
  const forbiddenRes = await fetch(app.baseUrl + '/api/approval-flows', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + nonAdminToken },
    body: JSON.stringify({ approvalFlows: { payment: ['someone'] } })
  });
  assert.equal(forbiddenRes.status, 403);

  const admin = await createUser('admin');
  const adminToken = await login(admin);
  const marker = uniqueId('flowmarker');
  const okRes = await fetch(app.baseUrl + '/api/approval-flows', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
    body: JSON.stringify({ approvalFlows: { payment: [marker] } })
  });
  const okBody = await okRes.json();
  assert.equal(okRes.status, 200, JSON.stringify(okBody));

  const db = testDb();
  const row = await db.query(`select data from hrms_state where key = 'default'`);
  const flows = row.rows[0]?.data?.approvalFlows;
  assert.ok(flows?.payment?.includes(marker), 'approvalFlows应该被正确写入hrms_state');
});
