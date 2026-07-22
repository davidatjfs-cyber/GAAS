import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant, appendStateEmployee } from './helpers/db.mjs';

// P1覆盖：请假审批(leave)是自助审批类型里验证逻辑最简单的一种，用来覆盖
// "创建审批单->分配审批人链->审批人同意->状态流转"这条核心审批工作流。
// 审批人链的第一环固定是申请人的直属上级(applicantManager)，后面几环
// (总部营运/人事经理)在测试库里可能因为其他测试文件留下的数据而不确定是谁，
// 所以断言只锁定"第一环"的行为，不对整单最终状态做强断言，避免测试间数据
// 互相干扰导致的假失败。

let app;

async function createUser(username, role, tenantId = 'default') {
  const db = testDb();
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', $3, true, $4)
     on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [username, hash, role, tenantId]
  );
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

test('请假申请：创建->直属上级审批通过，chain第一环正确流转', async () => {
  const applicantUsername = uniqueId('leaveapp');
  const managerUsername = uniqueId('leavemgr');

  // 直属上级要能通过 canAccessApprovalCenter 门禁才能审批，用 hq_manager 角色
  await createUser(managerUsername, 'hq_manager');
  await createUser(applicantUsername, 'store_employee');

  // hrms_state.employees 里要有申请人记录，且 managerUsername 指向上面创建的经理，
  // 这样 /api/approvals(POST) 里的 applicantManager 才能解析出来
  await appendStateEmployee('default', {
    username: applicantUsername,
    role: 'store_employee',
    store: '测试门店',
    managerUsername
  });

  const applicantToken = await login(applicantUsername);
  const createRes = await fetch(app.baseUrl + '/api/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + applicantToken },
    body: JSON.stringify({
      type: 'leave',
      payload: { startDate: '2026-08-01', endDate: '2026-08-03', reason: '年假' }
    })
  });
  const createBody = await createRes.json();
  assert.equal(createRes.status, 200, JSON.stringify(createBody));
  const approvalId = createBody.item?.id;
  assert.ok(approvalId, '应该返回审批单id');
  assert.equal(createBody.item.chain[0].assignee, managerUsername, '审批链第一环应该是申请人的直属上级');
  assert.equal(createBody.item.chain[0].status, 'pending');

  const managerToken = await login(managerUsername);
  const decideRes = await fetch(app.baseUrl + `/api/approvals/${approvalId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + managerToken },
    body: JSON.stringify({ approved: true, note: '同意' })
  });
  const decideBody = await decideRes.json();
  assert.equal(decideRes.status, 200, JSON.stringify(decideBody));
  const managerStep = decideBody.item.chain.find((c) => c.assignee === managerUsername);
  assert.equal(managerStep.status, 'approved', '直属上级这一环应该变成approved');
  assert.equal(managerStep.note, '同意');
});

test('请假申请：缺少日期应该被拒绝', async () => {
  const applicantUsername = uniqueId('leaveapp2');
  const managerUsername = uniqueId('leavemgr2');
  await createUser(managerUsername, 'hq_manager');
  await createUser(applicantUsername, 'store_employee');
  await appendStateEmployee('default', {
    username: applicantUsername,
    role: 'store_employee',
    store: '测试门店',
    managerUsername
  });

  const token = await login(applicantUsername);
  const res = await fetch(app.baseUrl + '/api/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ type: 'leave', payload: { reason: '年假' } })
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'missing_leave_date');
});

test('非审批人不能对别人的审批单做决定', async () => {
  const applicantUsername = uniqueId('leaveapp3');
  const managerUsername = uniqueId('leavemgr3');
  const outsiderUsername = uniqueId('outsider');
  await createUser(managerUsername, 'hq_manager');
  await createUser(applicantUsername, 'store_employee');
  await createUser(outsiderUsername, 'hq_manager'); // 角色能过canAccessApprovalCenter门禁，但不在这条chain里
  await appendStateEmployee('default', {
    username: applicantUsername,
    role: 'store_employee',
    store: '测试门店',
    managerUsername
  });

  const applicantToken = await login(applicantUsername);
  const createRes = await fetch(app.baseUrl + '/api/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + applicantToken },
    body: JSON.stringify({ type: 'leave', payload: { startDate: '2026-08-01', endDate: '2026-08-03' } })
  });
  const createBody = await createRes.json();
  assert.equal(createRes.status, 200, JSON.stringify(createBody));

  const outsiderToken = await login(outsiderUsername);
  const decideRes = await fetch(app.baseUrl + `/api/approvals/${createBody.item?.id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + outsiderToken },
    body: JSON.stringify({ approved: true })
  });
  const decideBody = await decideRes.json();
  assert.equal(decideRes.status, 403, JSON.stringify(decideBody));
});

test('回归：pickHqManagerUsername的DB兜底查询不应该跨租户拿到别的租户的hq_manager', async () => {
  const db = testDb();
  const otherTenant = uniqueId('leak_tenant');
  await db.query(
    `insert into tenants (tenant_id, name, status) values ($1, '别的租户', 'active')`,
    [otherTenant]
  );
  // 这个hq_manager只存在于别的租户的users表里，不在任何hrms_state.employees里——
  // 专门用来命中 pickHqManagerUsername() 里"state里找不到就查DB"的兜底分支
  const foreignHqManager = uniqueId('foreignhq');
  await createUser(foreignHqManager, 'hq_manager', otherTenant);

  const applicantUsername = uniqueId('leaveapp4');
  const managerUsername = uniqueId('leavemgr4');
  await createUser(managerUsername, 'store_manager'); // 直属上级，不是hq_manager，不影响这条测试
  await createUser(applicantUsername, 'store_employee');
  await appendStateEmployee('default', {
    username: applicantUsername,
    role: 'store_employee',
    store: '测试门店',
    managerUsername
  });

  const token = await login(applicantUsername);
  const res = await fetch(app.baseUrl + '/api/approvals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ type: 'leave', payload: { startDate: '2026-08-01', endDate: '2026-08-03' } })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  const assignees = body.item.chain.map((c) => c.assignee);
  assert.ok(
    !assignees.includes(foreignHqManager),
    '审批链不应该出现别的租户的hq_manager: ' + JSON.stringify(assignees)
  );
});
