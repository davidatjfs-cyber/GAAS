/**
 * Wave 4c：approvals 生命周期（create 鉴权/缺参 + return/resubmit）集成测。
 * leave 创建成功路径已由 approvals-leave.test.mjs 覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant, appendStateEmployee } from './helpers/db.mjs';

let app;

async function createUser(username, role, tenantId = 'default') {
  const db = testDb();
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', $3, true, $4)
     on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role, is_active = true`,
    [username, hash, role, tenantId]
  );
}

async function login(username) {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Pass12345' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.token;
}

async function insertPendingLeave({ applicant, assignee }) {
  const db = testDb();
  const id = randomUUID();
  const chain = [{ step: 1, assignee, status: 'pending' }];
  const payload = { startDate: '2026-09-01', endDate: '2026-09-02', reason: 'wave4c' };
  await db.query(
    `insert into approval_requests
       (id, type, status, applicant_username, current_assignee_username, chain, payload, tenant_id)
     values ($1,'leave','pending',$2,$3,$4::jsonb,$5::jsonb,'default')`,
    [id, applicant, assignee, JSON.stringify(chain), JSON.stringify(payload)]
  );
  return id;
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('POST /api/approvals：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'leave', payload: { startDate: '2026-09-01', endDate: '2026-09-02' } }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/approvals：invalid type → 400', async () => {
  // 无效 type 不会落入自助白名单；普通员工会先被审批中心门禁 403。
  // 用有审批中心权限的角色验证真正的 invalid_type 校验。
  const username = uniqueId('ap_badtype');
  await createUser(username, 'hq_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ type: 'not_a_real_type', payload: {} }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'invalid_type');
});

test('POST /api/approvals/:id/return：非当前审批人 → 403', async () => {
  const applicant = uniqueId('ap_ret_app');
  const assignee = uniqueId('ap_ret_asg');
  const outsider = uniqueId('ap_ret_out');
  await createUser(applicant, 'store_employee');
  await createUser(assignee, 'hq_manager');
  await createUser(outsider, 'hq_manager');
  const id = await insertPendingLeave({ applicant, assignee });
  const token = await login(outsider);
  const res = await fetch(app.baseUrl + `/api/approvals/${id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ note: '不该成功' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/approvals/:id/return → resubmit：审批人退回后申请人可重提', async () => {
  const applicant = uniqueId('ap_ok_app');
  const assignee = uniqueId('ap_ok_asg');
  await createUser(applicant, 'store_employee');
  await createUser(assignee, 'hq_manager');
  await appendStateEmployee('default', {
    username: applicant,
    role: 'store_employee',
    store: '测试门店',
    managerUsername: assignee,
    name: '申请人',
  });
  const id = await insertPendingLeave({ applicant, assignee });

  const asgToken = await login(assignee);
  const retRes = await fetch(app.baseUrl + `/api/approvals/${id}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + asgToken },
    body: JSON.stringify({ note: '请改日期' }),
  });
  const retBody = await retRes.json();
  assert.equal(retRes.status, 200, JSON.stringify(retBody));
  assert.equal(retBody.item?.status, 'returned');

  const appToken = await login(applicant);
  const reRes = await fetch(app.baseUrl + `/api/approvals/${id}/resubmit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + appToken },
    body: JSON.stringify({
      payload: { startDate: '2026-09-10', endDate: '2026-09-11', reason: '改期后' },
    }),
  });
  const reBody = await reRes.json();
  assert.equal(reRes.status, 200, JSON.stringify(reBody));
  assert.equal(reBody.item?.status, 'pending');
});

test('POST /api/approvals/:id/resubmit：非申请人 → 403', async () => {
  const applicant = uniqueId('ap_rs_app');
  const assignee = uniqueId('ap_rs_asg');
  const other = uniqueId('ap_rs_other');
  await createUser(applicant, 'store_employee');
  await createUser(assignee, 'hq_manager');
  await createUser(other, 'store_employee');
  const db = testDb();
  const id = randomUUID();
  const chain = [{ step: 1, assignee, status: 'returned' }];
  await db.query(
    `insert into approval_requests
       (id, type, status, applicant_username, current_assignee_username, chain, payload, tenant_id)
     values ($1,'leave','returned',$2,null,$3::jsonb,$4::jsonb,'default')`,
    [id, applicant, JSON.stringify(chain), JSON.stringify({ startDate: '2026-09-01', endDate: '2026-09-02' })]
  );
  const token = await login(other);
  const res = await fetch(app.baseUrl + `/api/approvals/${id}/resubmit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ payload: { startDate: '2026-09-01', endDate: '2026-09-02' } }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('POST /api/approvals/:id/return：缺 id 路径不存在 → 404 路由或 missing', async () => {
  const assignee = uniqueId('ap_noid');
  await createUser(assignee, 'hq_manager');
  const token = await login(assignee);
  const res = await fetch(app.baseUrl + `/api/approvals/${randomUUID()}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ note: 'x' }),
  });
  const body = await res.json();
  assert.equal(res.status, 404, JSON.stringify(body));
  assert.equal(body.error, 'not_found');
});
