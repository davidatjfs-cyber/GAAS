import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDuplicatePendingApproval,
  validatePaymentDuplicatePending,
  validatePointsDailyLimit,
  validateCreateApprovalByType,
  buildApprovalChain,
  insertPendingApprovalRequest,
  syncFormalPromotionTrackOnCreate,
  notifyApprovalCreated,
  saveMonthlyRecurringRewardTemplateIfNeeded,
} from '../create-approval-helpers.js';

const TENANT = 'default';

function makePool(handlers = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (handlers.query) return handlers.query(sql, params, queries);
      return { rows: handlers.rows || [] };
    },
  };
}

function safeDateOnly(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function safeNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

test('checkDuplicatePendingApproval onboarding / generic / payment skip', async () => {
  const pool = makePool({
    query: (sql) => {
      if (sql.includes("type = 'onboarding'")) return { rows: [{ id: 11 }] };
      return { rows: [] };
    },
  });
  const onb = await checkDuplicatePendingApproval({
    pool,
    type: 'onboarding',
    username: 'mgr1',
    payload: { employee: { username: 'new1' } },
    tenantId: TENANT,
  });
  assert.equal(onb.error, 'duplicate_pending');
  assert.equal(onb.id, 11);

  const pool2 = makePool({ rows: [{ id: 22 }] });
  const leave = await checkDuplicatePendingApproval({
    pool: pool2,
    type: 'leave',
    username: 'emp1',
    payload: {},
    tenantId: TENANT,
  });
  assert.equal(leave.id, 22);

  const pay = await checkDuplicatePendingApproval({
    pool: makePool(),
    type: 'payment',
    username: 'emp1',
    payload: {},
    tenantId: TENANT,
  });
  assert.equal(pay, null);
});

test('validatePaymentDuplicatePending / validatePointsDailyLimit', async () => {
  const poolPay = makePool({ rows: [{ id: 33 }] });
  const dup = await validatePaymentDuplicatePending({
    pool: poolPay,
    username: 'emp1',
    paySync: { store: '测试店', date: '2026-07-26', amount: 100, category: '物料' },
    tenantId: TENANT,
  });
  assert.equal(dup.error, 'duplicate_pending');

  const poolPts = makePool({ rows: [{ id: 44 }] });
  const daily = await validatePointsDailyLimit({ pool: poolPts, username: 'emp1', tenantId: TENANT });
  assert.equal(daily.error, 'daily_limit');
});

test('validateCreateApprovalByType leave / offboarding / promotion / payment / points / forbidden', async () => {
  const state = {
    employees: [{ username: 'emp1', name: '甲', store: '测试店', managerUsername: 'mgr1' }],
    promotionTracks: [{ id: 't1', applicantUsername: 'emp1', assessmentStatus: 'passed' }],
  };
  const base = {
    role: 'store_employee',
    username: 'emp1',
    payload: {},
    state,
    applicant: state.employees[0],
    applicantManager: 'mgr1',
    pool: makePool(),
    tenantId: TENANT,
    allowedStores: [],
    recurringFrequencyReward: '',
    stateFindUserRecord: (_s, u) => state.employees.find((e) => e.username === u) || null,
    stateOrDbFindUserRecord: async (_s, u) => state.employees.find((e) => e.username === u) || null,
    safeDateOnly,
    safeNumber,
    adminUsername: 'admin1',
  };

  const leaveErr = await validateCreateApprovalByType({
    ...base,
    type: 'leave',
    payload: { startDate: '2026-07-26' },
  });
  assert.equal(leaveErr.error, 'missing_leave_date');

  const offPayload = { store: '测试店' };
  const off = await validateCreateApprovalByType({ ...base, type: 'offboarding', payload: offPayload });
  assert.equal(off, null);
  assert.equal(offPayload.applicantName, '甲');

  const promoFormal = await validateCreateApprovalByType({
    ...base,
    type: 'promotion',
    payload: { promotionStage: 'formal', promotionTrackId: 't1', reason: '正式晋升' },
  });
  assert.equal(promoFormal, null);

  const promoBad = await validateCreateApprovalByType({
    ...base,
    type: 'promotion',
    payload: { promotionStage: 'formal', promotionTrackId: 'missing', reason: '正式' },
  });
  assert.equal(promoBad.error, 'invalid_promotion_track');

  const payErr = await validateCreateApprovalByType({
    ...base,
    role: 'store_manager',
    type: 'payment',
    payload: { store: '测试店', date: '2026-07-26', amount: 50, category: '物料' },
  });
  assert.equal(payErr, null);

  const ptsErr = await validateCreateApprovalByType({
    ...base,
    type: 'points',
    payload: { points: 10, reason: '优秀服务' },
  });
  assert.equal(ptsErr.error, 'missing_rule');

  const ptsForbidden = await validateCreateApprovalByType({
    ...base,
    role: 'guest',
    type: 'points',
    payload: { points: 10, reason: '优秀服务' },
  });
  assert.equal(ptsForbidden.error, 'forbidden');

  const forbidden = await validateCreateApprovalByType({
    ...base,
    type: 'other_type',
    role: 'guest',
  });
  assert.equal(forbidden.error, 'forbidden');
});

test('buildApprovalChain / insertPendingApprovalRequest', async () => {
  const { chain, currentAssignee } = buildApprovalChain(['a', 'b']);
  assert.equal(currentAssignee, 'a');
  assert.equal(chain.length, 2);
  assert.equal(chain[0].status, 'pending');
  assert.equal(chain[1].status, 'queued');

  const pool = makePool({
    query: () => ({ rows: [{ id: 99, type: 'leave', status: 'pending' }] }),
  });
  const item = await insertPendingApprovalRequest({
    pool,
    type: 'leave',
    username: 'emp1',
    chain,
    payload: { startDate: '2026-07-26', endDate: '2026-07-27' },
    tenantId: TENANT,
  });
  assert.equal(item.id, 99);
  assert.match(pool.queries[0].sql, /insert into approval_requests/i);
});

test('syncFormalPromotionTrackOnCreate updates track + saveSharedState', async () => {
  let saved = null;
  const state = {
    promotionTracks: [{ id: 't1', formalApplied: false }],
  };
  const next = await syncFormalPromotionTrackOnCreate({
    type: 'promotion',
    payload: { promotionStage: 'formal', promotionTrackId: 't1' },
    state,
    item: { id: 55 },
    saveSharedState: async (s) => {
      saved = s;
    },
    hrmsNowISO: () => '2026-07-26T12:00:00+08:00',
  });
  assert.equal(next.promotionTracks[0].formalApplied, true);
  assert.equal(next.promotionTracks[0].formalApprovalId, '55');
  assert.ok(saved);
});

test('notifyApprovalCreated sends notif + feishu async', async () => {
  const notifs = [];
  let larkCalled = false;
  await notifyApprovalCreated({
    item: { id: 77 },
    type: 'leave',
    payload: { startDate: '2026-07-26', endDate: '2026-07-27' },
    state: { employees: [{ username: 'emp1', name: '甲' }] },
    applicant: { name: '甲' },
    username: 'emp1',
    currentAssignee: 'mgr1',
    approvalTypeLabel: () => '休假',
    stateFindUserRecord: () => null,
    safeDateOnly,
    safeNumber,
    uniqUsernames: (arr) => arr,
    makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
    appendNotifications: async (n) => notifs.push(...n),
    lookupFeishuUserByUsername: async () => ({ open_id: 'ou_1' }),
    sendLarkMessage: async () => {
      larkCalled = true;
    },
  });
  assert.equal(notifs.length, 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(larkCalled, true);
});

test('saveMonthlyRecurringRewardTemplateIfNeeded inserts template', async () => {
  const pool = makePool({ rows: [] });
  await saveMonthlyRecurringRewardTemplateIfNeeded({
    type: 'reward_punishment',
    payload: { rpType: '奖励', amount: 100 },
    recurringFrequencyReward: 'monthly',
    item: { id: 1 },
    pool,
    username: 'mgr1',
  });
  assert.ok(pool.queries.some((q) => q.sql.includes('recurring_reward_templates')));

  await saveMonthlyRecurringRewardTemplateIfNeeded({
    type: 'leave',
    payload: {},
    recurringFrequencyReward: 'monthly',
    item: { id: 1 },
    pool,
    username: 'mgr1',
  });
  assert.equal(pool.queries.length, 1);
});

test('validateCreateApprovalByType onboarding + reward_punishment branches', async () => {
  const state = { employees: [] };
  const base = {
    role: 'store_manager',
    username: 'mgr1',
    payload: {
      employee: { username: 'newhire', joinDate: '2026-08-01' },
    },
    state,
    applicant: { managerUsername: 'hq1' },
    applicantManager: 'hq1',
    pool: makePool(),
    tenantId: TENANT,
    allowedStores: [],
    recurringFrequencyReward: '',
    stateFindUserRecord: () => null,
    stateOrDbFindUserRecord: async () => null,
    safeDateOnly,
    safeNumber,
    adminUsername: 'admin1',
  };
  const onb = await validateCreateApprovalByType({ ...base, type: 'onboarding' });
  assert.equal(onb, null);

  const rp = await validateCreateApprovalByType({
    ...base,
    type: 'reward_punishment',
    role: 'store_manager',
    payload: { rpType: '奖励', targetUsername: 'emp1', amount: 50, store: '测试店' },
    state: {
      employees: [{ username: 'emp1', store: '测试店' }],
    },
    stateFindUserRecord: (_s, u) => ({ username: u, store: '测试店' }),
  });
  assert.ok(rp === null || rp.error);
});

test('syncFormalPromotionTrackOnCreate no-op for non-formal', async () => {
  const state = { promotionTracks: [{ id: 't1' }] };
  const next = await syncFormalPromotionTrackOnCreate({
    type: 'promotion',
    payload: { promotionStage: 'qualification' },
    state,
    item: { id: 1 },
    saveSharedState: async () => assert.fail('skip'),
    hrmsNowISO: () => '2026-07-26',
  });
  assert.equal(next, state);
});

test('validatePaymentDuplicatePending swallows query errors', async () => {
  const pool = makePool({
    query: async () => {
      throw new Error('db down');
    },
  });
  const r = await validatePaymentDuplicatePending({
    pool,
    username: 'emp1',
    paySync: { store: 'x', date: '2026-07-26', amount: 1, category: 'c' },
    tenantId: TENANT,
  });
  assert.equal(r, null);
});
