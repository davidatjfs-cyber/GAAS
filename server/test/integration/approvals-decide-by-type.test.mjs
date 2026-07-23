/**
 * P1.1：分类型 decide 集成测（通过 + 驳回）。
 * 直接插入单环审批链，专注测 decide 副作用路径，不依赖复杂建单逻辑。
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

async function insertPendingApproval({ type, applicant, assignee, payload }) {
  const db = testDb();
  const id = randomUUID();
  const chain = [{ step: 1, assignee, status: 'pending' }];
  await db.query(
    `insert into approval_requests
       (id, type, status, applicant_username, current_assignee_username, chain, payload, tenant_id)
     values ($1,$2,'pending',$3,$4,$5::jsonb,$6::jsonb,'default')`,
    [id, type, applicant, assignee, JSON.stringify(chain), JSON.stringify(payload || {})]
  );
  return id;
}

async function decide(token, id, body) {
  const res = await fetch(app.baseUrl + `/api/approvals/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { res, json };
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('leave：审批通过 → status=approved', async () => {
  const applicant = uniqueId('leave_ok_app');
  const manager = uniqueId('leave_ok_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '请假人',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'leave',
    applicant,
    assignee: manager,
    payload: { startDate: '2026-09-01', endDate: '2026-09-02', reason: '事假' },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: true, note: '准假' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'approved');
  assert.equal(json.item?.chain?.[0]?.status, 'approved');
});

test('leave：审批驳回 → status=rejected', async () => {
  const applicant = uniqueId('leave_no_app');
  const manager = uniqueId('leave_no_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '请假人驳',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'leave',
    applicant,
    assignee: manager,
    payload: { startDate: '2026-09-10', endDate: '2026-09-11', reason: '事假' },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: false, note: '人手不足' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'rejected');
  assert.equal(json.item?.chain?.[0]?.status, 'rejected');
});

test('offboarding：审批通过 → status=approved + effective_date', async () => {
  const applicant = uniqueId('off_ok_app');
  const manager = uniqueId('off_ok_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '离职人',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'offboarding',
    applicant,
    assignee: manager,
    payload: { resignDate: '2026-12-31', reason: '个人原因' },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: true, departureType: 'voluntary' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'approved');
  assert.equal(String(json.item?.effective_date || '').slice(0, 10), '2026-12-31');
  assert.equal(json.item?.payload?.departureType, 'voluntary');
});

test('offboarding：审批驳回 → status=rejected', async () => {
  const applicant = uniqueId('off_no_app');
  const manager = uniqueId('off_no_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '离职人驳',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'offboarding',
    applicant,
    assignee: manager,
    payload: { resignDate: '2026-11-01' },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: false, note: '挽留' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'rejected');
});

test('points：审批通过 → status=approved', async () => {
  const applicant = uniqueId('pts_ok_app');
  const manager = uniqueId('pts_ok_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '积分人',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'points',
    applicant,
    assignee: manager,
    payload: { store: '测试门店', points: 2, itemName: '卫生优秀', reason: '本周卫生优秀', bizMonth: '2026-07' },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: true });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'approved');
});

test('points：审批驳回 → status=rejected', async () => {
  const applicant = uniqueId('pts_no_app');
  const manager = uniqueId('pts_no_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '积分人驳',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'points',
    applicant,
    assignee: manager,
    payload: { store: '测试门店', points: 1, itemName: '事项', reason: '理由', bizMonth: '2026-07' },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: false, note: '证据不足' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'rejected');
});

test('reward_punishment：审批通过 → status=approved', async () => {
  const applicant = uniqueId('rp_ok_app');
  const target = uniqueId('rp_ok_tgt');
  const manager = uniqueId('rp_ok_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_manager');
  await createUser(target, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '发起人',
    role: 'store_manager',
    store: '测试门店',
    managerUsername: manager,
  });
  await appendStateEmployee('default', {
    username: target,
    name: '奖惩对象',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: applicant,
  });
  const id = await insertPendingApproval({
    type: 'reward_punishment',
    applicant,
    assignee: manager,
    payload: {
      targetUsername: target,
      rpType: '奖励',
      amount: 100,
      reason: '表现优秀',
      result: '通报表扬',
      bizMonth: '2026-07',
    },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: true });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'approved');
});

test('reward_punishment：审批驳回 → status=rejected', async () => {
  const applicant = uniqueId('rp_no_app');
  const target = uniqueId('rp_no_tgt');
  const manager = uniqueId('rp_no_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_manager');
  await createUser(target, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '发起人驳',
    role: 'store_manager',
    store: '测试门店',
    managerUsername: manager,
  });
  await appendStateEmployee('default', {
    username: target,
    name: '奖惩对象驳',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: applicant,
  });
  const id = await insertPendingApproval({
    type: 'reward_punishment',
    applicant,
    assignee: manager,
    payload: {
      targetUsername: target,
      rpType: '惩罚',
      amount: 50,
      reason: '迟到',
      result: '扣款',
      bizMonth: '2026-07',
    },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: false, note: '证据不足' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'rejected');
});

test('onboarding：店长提交的入职单，总部经理通过 → approved', async () => {
  const submitter = uniqueId('onb_ok_sm');
  const manager = uniqueId('onb_ok_mgr');
  const newEmp = uniqueId('onb_ok_new');
  await createUser(manager, 'hq_manager');
  await createUser(submitter, 'store_manager');
  await appendStateEmployee('default', {
    username: submitter,
    name: '店长',
    role: 'store_manager',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'onboarding',
    applicant: submitter,
    assignee: manager,
    payload: {
      employee: {
        username: newEmp,
        name: '新员工甲',
        role: 'store_employee',
        store: '测试门店',
        joinDate: '2026-08-01',
        salary: 5000,
        managerUsername: submitter,
      },
    },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: true });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'approved');
});

test('onboarding：审批驳回 → status=rejected', async () => {
  const submitter = uniqueId('onb_no_sm');
  const manager = uniqueId('onb_no_mgr');
  const newEmp = uniqueId('onb_no_new');
  await createUser(manager, 'hq_manager');
  await createUser(submitter, 'store_manager');
  await appendStateEmployee('default', {
    username: submitter,
    name: '店长驳',
    role: 'store_manager',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'onboarding',
    applicant: submitter,
    assignee: manager,
    payload: {
      employee: {
        username: newEmp,
        name: '新员工乙',
        role: 'store_employee',
        store: '测试门店',
        joinDate: '2026-08-02',
      },
    },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: false, note: '资料不全' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'rejected');
});

test('promotion：资格阶段审批通过 → approved', async () => {
  const applicant = uniqueId('prm_ok_app');
  const manager = uniqueId('prm_ok_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '晋升人',
    role: 'store_employee',
    store: '测试门店',
    position: '服务员',
    level: 'L1',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'promotion',
    applicant,
    assignee: manager,
    payload: {
      promotionStage: 'qualification',
      reason: '表现突出申请资格认证',
      store: '测试门店',
    },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: true, note: '同意资格' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'approved');
});

test('promotion：审批驳回 → status=rejected', async () => {
  const applicant = uniqueId('prm_no_app');
  const manager = uniqueId('prm_no_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_employee');
  await appendStateEmployee('default', {
    username: applicant,
    name: '晋升人驳',
    role: 'store_employee',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'promotion',
    applicant,
    assignee: manager,
    payload: {
      promotionStage: 'qualification',
      reason: '申请资格',
    },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: false, note: '暂缓' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'rejected');
});

test('payment：请款单通过（无类型副作用，仅链流转）', async () => {
  const applicant = uniqueId('pay_ok_app');
  const manager = uniqueId('pay_ok_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_manager');
  await appendStateEmployee('default', {
    username: applicant,
    name: '请款人',
    role: 'store_manager',
    store: '测试门店',
    managerUsername: manager,
  });
  const id = await insertPendingApproval({
    type: 'payment',
    applicant,
    assignee: manager,
    payload: { store: '测试门店', amount: 200, category: '食材', date: '2026-07-20' },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: true });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'approved');
});

test('payment：请款单驳回', async () => {
  const applicant = uniqueId('pay_no_app');
  const manager = uniqueId('pay_no_mgr');
  await createUser(manager, 'hq_manager');
  await createUser(applicant, 'store_manager');
  const id = await insertPendingApproval({
    type: 'payment',
    applicant,
    assignee: manager,
    payload: { store: '测试门店', amount: 80, category: '杂费', date: '2026-07-21' },
  });
  const token = await login(manager);
  const { res, json } = await decide(token, id, { approved: false, note: '超预算' });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.item?.status, 'rejected');
});
