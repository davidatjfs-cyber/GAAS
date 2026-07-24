import test from 'node:test';
import assert from 'node:assert/strict';
import { createApproval } from '../domains/approvals/service-create.js';

const TENANT = 'default';

function makePool(handlers = {}) {
  const queries = [];
  const pool = {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (handlers.query) return handlers.query(sql, params, queries);
      return { rows: [] };
    },
  };
  return pool;
}

function safeDateOnly(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function safeNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function makeCreateDeps(overrides = {}) {
  const notifCalls = [];
  const state = overrides.state || {
    employees: [
      { username: 'emp1', name: '员工甲', store: '测试店', managerUsername: 'mgr1' },
    ],
  };

  const deps = {
    getSharedState: async () => state,
    saveSharedState: async () => {},
    stateFindUserRecord: (_s, u) => {
      const key = String(u || '').trim().toLowerCase();
      const emp = (state.employees || []).find(
        (e) => String(e.username || '').trim().toLowerCase() === key
      );
      return emp || null;
    },
    stateOrDbFindUserRecord: async (_s, u) => {
      const key = String(u || '').trim().toLowerCase();
      const emp = (state.employees || []).find(
        (e) => String(e.username || '').trim().toLowerCase() === key
      );
      return emp || null;
    },
    pickAdminUsername: async () => overrides.adminUsername ?? 'admin1',
    pickHqManagerUsername: async () => overrides.hqManagerUsername ?? 'hq1',
    pickCashierUsername: async () => overrides.cashierUsername ?? 'cashier1',
    pickHrManagerUsername: async () => overrides.hrManagerUsername ?? 'hr1',
    approvalTypeLabel: (t) => (t === 'leave' ? '休假' : t === 'points' ? '积分' : t === 'payment' ? '请款' : String(t)),
    safeDateOnly,
    safeNumber,
    uniqUsernames: (arr) => [...new Set((arr || []).map((x) => String(x || '').trim()).filter(Boolean))],
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => {},
    getPaymentFlowForStore: () => ({ approvers: [] }),
    pickStoreRoleUsernameByStore: () => overrides.storeManagerUsername ?? '',
    isKitchenByRoleOrPosition: () => false,
    resolveDutyApproverForStore: async () => null,
    appendNotifications: async (notifs) => {
      notifCalls.push(...(Array.isArray(notifs) ? notifs : [notifs]));
    },
    makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
    hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    username: 'emp1',
    role: 'store_employee',
    type: 'leave',
    payload: {},
    recurringFrequencyReward: '',
    tenantId: TENANT,
    allowedStores: [],
    ...overrides.params,
  };

  return { deps, notifCalls, state };
}

test('createApproval: leave invalid dates → missing_leave_date', async () => {
  const pool = makePool();
  const { deps } = makeCreateDeps({
    params: {
      type: 'leave',
      payload: { startDate: '2026-07-25' },
    },
  });
  const result = await createApproval({ pool, ...deps });
  assert.equal(result.error, 'missing_leave_date');
  assert.equal(result.status, 400);
});

test('createApproval: leave missing_manager', async () => {
  const pool = makePool();
  const { deps } = makeCreateDeps({
    state: {
      employees: [{ username: 'emp1', name: '员工甲', store: '测试店' }],
    },
    params: {
      type: 'leave',
      payload: { startDate: '2026-07-25', endDate: '2026-07-26' },
    },
  });
  const result = await createApproval({ pool, ...deps });
  assert.equal(result.error, 'missing_manager');
  assert.equal(result.status, 400);
});

test('createApproval: leave success inserts and notifies', async () => {
  let insertArgs = null;
  const pool = makePool({
    query: async (sql, params) => {
      if (sql.includes('select id from approval_requests')) return { rows: [] };
      if (sql.includes('insert into approval_requests')) {
        insertArgs = params;
        const chain = JSON.parse(params[4]);
        return {
          rows: [{
            id: 'leave-new-1',
            type: 'leave',
            status: 'pending',
            applicant_username: 'emp1',
            current_assignee_username: chain[0]?.assignee,
            chain,
            payload: JSON.parse(params[5]),
          }],
        };
      }
      return { rows: [] };
    },
  });
  const { deps, notifCalls } = makeCreateDeps({
    params: {
      type: 'leave',
      payload: { startDate: '2026-07-25', endDate: '2026-07-26' },
    },
  });
  const result = await createApproval({ pool, ...deps });
  assert.equal(result.ok, true);
  assert.ok(result.item);
  assert.equal(result.label, '休假');
  assert.ok(Array.isArray(result.item.chain));
  assert.ok(result.item.chain.length >= 1);
  assert.equal(result.item.chain[0].status, 'pending');
  assert.ok(insertArgs);
  assert.equal(notifCalls.length, 1);
});

test('createApproval: duplicate_pending → 409', async () => {
  const pool = makePool({
    query: async (sql) => {
      if (sql.includes('select id from approval_requests')) {
        return { rows: [{ id: 'dup-99' }] };
      }
      return { rows: [] };
    },
  });
  const { deps } = makeCreateDeps({
    params: {
      type: 'leave',
      payload: { startDate: '2026-07-25', endDate: '2026-07-26' },
    },
  });
  const result = await createApproval({ pool, ...deps });
  assert.equal(result.error, 'duplicate_pending');
  assert.equal(result.status, 409);
  assert.equal(result.id, 'dup-99');
});

test('createApproval: points wrong role → forbidden', async () => {
  const pool = makePool({
    query: async (sql) => {
      if (sql.includes('select id from approval_requests')) return { rows: [] };
      return { rows: [] };
    },
  });
  const { deps } = makeCreateDeps({
    params: {
      role: 'store_manager',
      type: 'points',
      payload: { ruleId: 'r1', reason: '表现好' },
    },
    state: {
      employees: [{ username: 'emp1', store: '测试店', managerUsername: 'mgr1' }],
      pointRules: [{ id: 'r1', itemName: '加分', points: 5, enabled: true }],
    },
  });
  const result = await createApproval({ pool, ...deps });
  assert.equal(result.error, 'forbidden');
  assert.equal(result.status, 403);
});

test('createApproval: points daily_limit → 400', async () => {
  const pool = makePool({
    query: async (sql) => {
      if (sql.includes("type='points'") && sql.includes('CURRENT_DATE')) {
        return { rows: [{ id: 'pts-today' }] };
      }
      if (sql.includes('select id from approval_requests')) return { rows: [] };
      return { rows: [] };
    },
  });
  const { deps } = makeCreateDeps({
    params: {
      role: 'store_employee',
      type: 'points',
      payload: { ruleId: 'r1', reason: '表现好' },
    },
    state: {
      employees: [{ username: 'emp1', store: '测试店', managerUsername: 'mgr1' }],
      pointRules: [{ id: 'r1', itemName: '加分', points: 5, enabled: true }],
    },
  });
  const result = await createApproval({ pool, ...deps });
  assert.equal(result.error, 'daily_limit');
  assert.equal(result.status, 400);
  assert.match(result.message, /每天只能提交1次/);
});

test('createApproval: missing_assignee when promotion has no store manager', async () => {
  const pool = makePool({
    query: async (sql) => {
      if (sql.includes('select id from approval_requests')) return { rows: [] };
      return { rows: [] };
    },
  });
  const { deps } = makeCreateDeps({
    params: {
      type: 'promotion',
      payload: { reason: '申请晋升', promotionStage: 'qualification' },
    },
    state: {
      employees: [{ username: 'emp1', store: '测试店', managerUsername: 'mgr1', position: '服务员' }],
    },
  });
  const result = await createApproval({ pool, ...deps });
  assert.equal(result.error, 'missing_assignee');
  assert.equal(result.status, 400);
});

test('createApproval: payment missing_amount for store_manager', async () => {
  const pool = makePool({
    query: async (sql) => {
      if (sql.includes('SELECT id FROM approval_requests') && sql.includes("type = 'payment'")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  });
  const { deps } = makeCreateDeps({
    params: {
      role: 'store_manager',
      type: 'payment',
      payload: {
        store: '测试店',
        date: '2026-07-25',
        category: '物料',
      },
    },
  });
  const result = await createApproval({ pool, ...deps });
  assert.equal(result.error, 'missing_amount');
  assert.equal(result.status, 400);
});
