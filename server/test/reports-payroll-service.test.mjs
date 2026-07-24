import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPayrollReportPayload,
  auditPayrollMonth,
  adjustPayrollRow,
} from '../domains/reports/service-payroll.js';
import { bindReportsRuntimeDeps } from '../domains/reports/helpers.js';

const NOW = '2026-07-24T12:00:00+08:00';

function makePool(handlers = {}) {
  return {
    query: async (sql, params) => {
      if (handlers.query) return handlers.query(sql, params);
      return { rows: [] };
    },
  };
}

function baseCtx(overrides = {}) {
  const merges = [];
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
    mergeSharedStateFields: async (patch) => {
      merges.push(patch);
    },
    pickMyStoreFromState: () => overrides.myStore || '',
    stateFindUserRecord: () => null,
    dbListEmployeesForReports: async () => overrides.dbEmployees || [],
    calcEmployeeMonthlyLeaveBalance: () => ({ remaining: 0 }),
    buildAttendanceFromCheckinRecords: () => [],
    buildAttendanceFromReports: () => [],
    isLegacyTestUsername: () => false,
    inDateRange: () => true,
    clampNum: (n, fallback = 0) => {
      const x = Number(n);
      return Number.isFinite(x) ? x : fallback;
    },
    safeNumber: (n) => {
      if (n == null || n === '') return null;
      const x = Number(n);
      return Number.isFinite(x) ? x : null;
    },
    findUserSalary: () => null,
    hrmsNowISO: () => NOW,
    buildPayrollForMonth: overrides.buildPayrollForMonth,
    summarizeAttendanceDaysForMonth: async () => ({ restDays: 0 }),
    upsertPayrollLedgerEntry: overrides.upsertPayrollLedgerEntry || (async () => {}),
    ...overrides.ctxExtra,
  };
  return { ctx, merges };
}

test('getPayrollReportPayload: closed_loop success → engine closed_loop_v1', async () => {
  const { ctx } = baseCtx({
    state: {
      employees: [{ username: 'alice', name: '爱丽丝', store: '测试店', status: 'active' }],
    },
    buildPayrollForMonth: async () => ({
      ok: true,
      monthDays: 31,
      workDaysPerMonth: 27,
      rows: [{
        store: '测试店',
        username: 'alice',
        name: '爱丽丝',
        attendanceDays: 20,
        payableAttendanceDays: 20,
        workDaysPerMonth: 27,
        leaveRemaining: 2,
        monthlySalary: 5400,
        dailyRate: 200,
        baseAmount: 4000,
        rewardPunishmentAdj: 0,
        subsidy: 0,
        pointsAmount: 0,
        manualSubsidy: 0,
        amount: 4000,
        prorationMode: 'daily',
        salarySource: 'timeline',
        ledgerItems: [],
        attendanceSummary: null,
      }],
      rules: { version: 1 },
      monthRun: { id: 'run1' },
      resolvedFrom: 'rules',
    }),
  });

  const result = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '测试店',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.engine, 'closed_loop_v1');
  assert.equal(result.payload.rows.length, 1);
  assert.equal(result.payload.rows[0].username, 'alice');
  assert.equal(result.payload.totalAmount, 4000);
});

test('getPayrollReportPayload: closed_loop throw → engine legacy_fallback', async () => {
  const { ctx } = baseCtx({
    state: {},
    buildPayrollForMonth: async () => {
      throw new Error('engine boom');
    },
  });

  const result = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.payload.engine, 'legacy_fallback');
  assert.deepEqual(result.payload.rows, []);
  assert.equal(result.payload.totalAmount, 0);
});

test('getPayrollReportPayload: missing month', async () => {
  const { ctx } = baseCtx({ state: {} });
  const result = await getPayrollReportPayload(ctx, {
    month: '',
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
});

test('auditPayrollMonth: missing month', async () => {
  const { ctx } = baseCtx({ state: {} });
  const result = await auditPayrollMonth(ctx, {
    month: '',
    store: '测试店',
    username: 'boss',
    audited: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing_month');
  assert.equal(result.status, 400);
});

test('auditPayrollMonth: writes payrollAudits via mergeSharedStateFields', async () => {
  const { ctx, merges } = baseCtx({
    state: { payrollAudits: {} },
  });

  const result = await auditPayrollMonth(ctx, {
    month: '2026-07',
    store: '测试店',
    username: 'boss',
    audited: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.audit.audited, true);
  assert.equal(result.audit.auditedBy, 'boss');
  assert.equal(result.audit.auditedAt, NOW);
  assert.equal(merges.length, 1);
  assert.ok(merges[0].payrollAudits);
  assert.equal(merges[0].payrollAudits['2026-07||测试店'].auditedBy, 'boss');
});

test('adjustPayrollRow: missing_adjustment when neither subsidy nor baseAmount', async () => {
  const { ctx } = baseCtx({ state: {} });
  const result = await adjustPayrollRow(ctx, {
    month: '2026-07',
    store: '测试店',
    targetUsername: 'alice',
    subsidy: null,
    baseAmount: undefined,
    username: 'boss',
    tenantId: 'default',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing_adjustment');
});
