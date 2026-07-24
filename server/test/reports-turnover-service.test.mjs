import test from 'node:test';
import assert from 'node:assert/strict';
import { getTurnoverReportPayload } from '../domains/reports/service-turnover.js';
import { bindReportsRuntimeDeps } from '../domains/reports/helpers.js';

function makePool(handlers = {}) {
  return {
    query: async (sql, params) => {
      if (handlers.query) return handlers.query(sql, params);
      return { rows: [] };
    },
  };
}

function baseCtx(overrides = {}) {
  const pool = overrides.pool || makePool();
  bindReportsRuntimeDeps({
    pool,
    safeMonthOnly: (m) => {
      const s = String(m || '').trim();
      return /^\d{4}-\d{2}$/.test(s) ? s : '';
    },
    resolveAgentCanonicalStore: (s) => String(s || '').trim(),
    getSharedState: async () => overrides.state || {},
  });

  const ctx = {
    pool,
    getSharedState: async () => overrides.state || {},
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : '';
    },
    pickMyStoreFromState: () => overrides.myStore || '',
    dbListEmployeesForReports: async () => overrides.dbEmployees || [],
    expandAgentStoreLabels: (s) => [String(s || '').trim()].filter(Boolean),
    ...overrides.ctxExtra,
  };
  return { ctx };
}

const RESPONSE_KEYS = [
  'month',
  'store',
  'totalHeadcount',
  'totalDeparted',
  'overallTurnoverRate',
  'criticalTalent',
  'newHire',
  'voluntaryInvoluntary',
  'departedDetails',
  'storeBreakdown',
];

test('getTurnoverReportPayload: missing/invalid month → missing_month', async () => {
  const { ctx } = baseCtx({ state: {} });

  for (const month of ['', '2026', '2026-7', 'abcd-ef']) {
    const result = await getTurnoverReportPayload(ctx, {
      month,
      storeQ: '',
      role: 'admin',
      username: 'boss',
      tenantId: 'default',
      allowedStores: [],
      currentStore: '',
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, 'missing_month');
  }
});

test('getTurnoverReportPayload: empty employees → 200 structure with known keys', async () => {
  const { ctx } = baseCtx({ state: { employees: [] } });

  const result = await getTurnoverReportPayload(ctx, {
    month: '2026-07',
    storeQ: '',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });

  assert.equal(result.ok, true);
  for (const k of RESPONSE_KEYS) assert.ok(k in result.payload, `missing key ${k}`);
  assert.equal(result.payload.month, '2026-07');
  assert.equal(result.payload.store, '');
  assert.equal(result.payload.totalHeadcount, 0);
  assert.equal(result.payload.totalDeparted, 0);
  assert.equal(result.payload.overallTurnoverRate, 0);
  assert.deepEqual(result.payload.criticalTalent, { total: 0, departed: 0, rate: 0 });
  assert.deepEqual(result.payload.newHire, {
    total: 0,
    departed: 0,
    turnoverRate: 0,
    retentionRate: 1,
  });
  assert.deepEqual(result.payload.voluntaryInvoluntary, {
    voluntary: 0,
    involuntary: 0,
    voluntaryRate: 0,
    involuntaryRate: 0,
  });
  assert.deepEqual(result.payload.departedDetails, []);
  assert.deepEqual(result.payload.storeBreakdown, []);
});

test('getTurnoverReportPayload: active employees → headcount / summary counts', async () => {
  const { ctx } = baseCtx({
    state: {
      employees: [
        {
          username: 'alice',
          name: '爱丽丝',
          store: '测试店',
          status: 'active',
          joinDate: '2025-01-01',
          level: '2',
        },
        {
          username: 'bob',
          name: '鲍勃',
          store: '测试店',
          status: '离职',
          joinDate: '2024-06-01',
          offboardingDate: '2026-07-10',
          coreTalent: true,
          level: '3',
        },
        {
          username: 'carol',
          name: '卡罗尔',
          store: '其他店',
          status: 'active',
          joinDate: '2026-06-01',
        },
      ],
    },
  });

  const result = await getTurnoverReportPayload(ctx, {
    month: '2026-07',
    storeQ: '测试店',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.store, '测试店');
  assert.equal(result.payload.totalHeadcount, 2);
  assert.equal(result.payload.totalDeparted, 1);
  assert.equal(result.payload.overallTurnoverRate, 0.5);
  assert.equal(result.payload.criticalTalent.total, 1);
  assert.equal(result.payload.criticalTalent.departed, 1);
  assert.equal(result.payload.criticalTalent.rate, 1);
  assert.equal(result.payload.voluntaryInvoluntary.voluntary, 1);
  assert.ok(Array.isArray(result.payload.storeBreakdown));
  assert.equal(result.payload.storeBreakdown.length, 1);
  assert.equal(result.payload.storeBreakdown[0].store, '测试店');
  assert.equal(result.payload.storeBreakdown[0].headcount, 2);
  assert.equal(result.payload.storeBreakdown[0].departed, 1);
});

test('getTurnoverReportPayload: store_manager converges via allowedStores/currentStore', async () => {
  const { ctx } = baseCtx({
    myStore: '我的店',
    state: {
      employees: [
        { username: 'a1', name: 'A1', store: '允许店A', status: 'active', joinDate: '2025-01-01' },
        { username: 'a2', name: 'A2', store: '允许店B', status: 'active', joinDate: '2025-01-01' },
        { username: 'a3', name: 'A3', store: '其他店', status: 'active', joinDate: '2025-01-01' },
      ],
    },
  });

  // storeQ 不在 allowed → 回落到 currentStore
  const r1 = await getTurnoverReportPayload(ctx, {
    month: '2026-07',
    storeQ: '其他店',
    role: 'store_manager',
    username: 'mgr',
    tenantId: 'default',
    allowedStores: ['允许店A', '允许店B'],
    currentStore: '允许店A',
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.payload.store, '允许店A');
  assert.equal(r1.payload.totalHeadcount, 1);

  // storeQ 在 allowed → 使用 storeQ
  const r2 = await getTurnoverReportPayload(ctx, {
    month: '2026-07',
    storeQ: '允许店B',
    role: 'store_manager',
    username: 'mgr',
    tenantId: 'default',
    allowedStores: ['允许店A', '允许店B'],
    currentStore: '允许店A',
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.payload.store, '允许店B');
  assert.equal(r2.payload.totalHeadcount, 1);

  // 无 storeQ、无 currentStore → 回落到 myStore
  const r3 = await getTurnoverReportPayload(ctx, {
    month: '2026-07',
    storeQ: '',
    role: 'store_manager',
    username: 'mgr',
    tenantId: 'default',
    allowedStores: ['允许店A', '允许店B'],
    currentStore: '',
  });
  assert.equal(r3.ok, true);
  assert.equal(r3.payload.store, '我的店');
  assert.equal(r3.payload.totalHeadcount, 0);
});
