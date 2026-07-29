import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPayrollReportPayload,
  auditPayrollMonth,
  adjustPayrollRow,
} from '../service-payroll.js';
import { bindReportsRuntimeDeps } from '../helpers.js';

const NOW = '2026-07-24T12:00:00+08:00';

function makePool(handlers = {}) {
  // upsertPayrollDomain 走 pool.connect() 的事务锁合并（SELECT ... FOR UPDATE + UPDATE），
  // 这里给个通用的最小实现：默认表里没有行（走一次 insert-empty-then-retry），第二轮
  // SELECT 返回空字段的行，UPDATE 直接成功——够用来验证 auditPayrollMonth/adjustPayrollRow
  // 的返回值和 payload 内容，不需要真的落库。
  let selectCount = 0;
  return {
    query: async (sql, params) => {
      if (handlers.query) return handlers.query(sql, params);
      return { rows: [] };
    },
    connect: handlers.connect || (async () => ({
      query: async (sql) => {
        const s = String(sql);
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return {};
        if (/SELECT[\s\S]*FROM hrms_payroll_domain[\s\S]*FOR UPDATE/i.test(s)) {
          selectCount += 1;
          if (selectCount === 1) return { rows: [] };
          return {
            rows: [{
              payroll_adjustments: {},
              payroll_audits: {},
              salary_adjustments: [],
              monthly_confirmations: [],
              updated_at: 'ts1',
            }],
          };
        }
        if (/INSERT INTO hrms_payroll_domain/i.test(s)) return {};
        if (/UPDATE hrms_payroll_domain/i.test(s)) return { rowCount: 1 };
        return { rows: [] };
      },
      release() {},
    })),
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
  return { ctx };
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

test('auditPayrollMonth: writes payrollAudits via upsertPayrollDomain', async () => {
  const { ctx } = baseCtx({
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

test('getPayrollReportPayload: store_manager 选店 + closed_loop 过滤离职无出勤', async () => {
  const { ctx } = baseCtx({
    state: {
      employees: [
        { username: 'alice', name: '爱丽丝', store: '洪潮', status: 'active' },
        { username: 'gone', name: '已离职', store: '洪潮', status: '离职' },
      ],
    },
    myStore: '洪潮',
    buildPayrollForMonth: async ({ people }) => {
      assert.ok(people.some((p) => p.username === 'alice'));
      return {
        ok: true,
        monthDays: 31,
        workDaysPerMonth: 27,
        rows: [
          {
            store: '洪潮',
            username: 'alice',
            name: '爱丽丝',
            attendanceDays: 20,
            payableAttendanceDays: 20,
            workDaysPerMonth: 27,
            leaveRemaining: 0,
            monthlySalary: 5000,
            dailyRate: 185,
            baseAmount: 3700,
            rewardPunishmentAdj: 0,
            subsidy: 0,
            pointsAmount: 0,
            manualSubsidy: 0,
            amount: 3700,
            prorationMode: 'attendance',
            salarySource: 'profile',
            ledgerItems: [],
            attendanceSummary: null,
          },
          {
            store: '洪潮',
            username: 'gone',
            name: '已离职',
            attendanceDays: 0,
            payableAttendanceDays: 0,
            workDaysPerMonth: 27,
            leaveRemaining: 0,
            monthlySalary: 5000,
            dailyRate: 185,
            baseAmount: 0,
            rewardPunishmentAdj: 0,
            subsidy: 0,
            pointsAmount: 0,
            manualSubsidy: 0,
            amount: 0,
            prorationMode: 'attendance',
            salarySource: 'profile',
            ledgerItems: [],
            attendanceSummary: null,
          },
        ],
        rules: {},
        monthRun: null,
        resolvedFrom: {},
      };
    },
  });

  const result = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '洪潮',
    role: 'store_manager',
    username: 'mgr',
    tenantId: 'default',
    allowedStores: ['洪潮', '马己仙'],
    currentStore: '洪潮',
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.rows.length, 1);
  assert.equal(result.payload.rows[0].username, 'alice');
});

test('getPayrollReportPayload: closed_loop 空 state 走 db 员工', async () => {
  const { ctx } = baseCtx({
    state: {},
    dbEmployees: [{ username: 'db1', name: '库员工', store: '洪潮', status: 'active' }],
    buildPayrollForMonth: async ({ people }) => {
      assert.equal(people.length, 1);
      assert.equal(people[0].username, 'db1');
      return {
        ok: true,
        monthDays: 31,
        workDaysPerMonth: 27,
        rows: [{
          store: '洪潮',
          username: 'db1',
          name: '库员工',
          attendanceDays: 10,
          payableAttendanceDays: 10,
          workDaysPerMonth: 27,
          leaveRemaining: 0,
          monthlySalary: 3000,
          dailyRate: 111,
          baseAmount: 1110,
          rewardPunishmentAdj: 0,
          subsidy: 0,
          pointsAmount: 0,
          manualSubsidy: 0,
          amount: 1110,
          prorationMode: 'attendance',
          salarySource: 'profile',
          ledgerItems: [],
          attendanceSummary: null,
        }],
        rules: {},
        monthRun: null,
        resolvedFrom: {},
      };
    },
  });
  const result = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '洪潮',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.rows[0].username, 'db1');
});

test('getPayrollReportPayload: legacy 路径含积分/奖惩/考勤/人工底薪覆盖', async () => {
  const { ctx } = baseCtx({
    // 不注入 buildPayrollForMonth → 直接走 legacy
    state: {
      employees: [
        { username: 'alice', name: '爱丽丝', store: '洪潮', status: 'active' },
        { username: 'bob', name: '鲍勃', store: '洪潮', status: 'active' },
      ],
      pointRecords: [
        {
          username: 'alice',
          store: '洪潮',
          points: 20,
          approvedAt: '2026-07-10T00:00:00+08:00',
        },
      ],
      salaryAdjustments: [
        {
          targetUsername: 'bob',
          status: 'approved',
          approvalId: 'appr-rp-1',
          type: '奖励',
          amount: 100,
          createdAt: '2026-06-01',
        },
      ],
      payrollAdjustments: {
        '2026-07||洪潮||alice': { baseAmount: 999, subsidy: 50 },
      },
      payrollAudits: { '2026-07||洪潮': { audited: true } },
    },
    pool: makePool({
      query: async (sql) => {
        if (/checkin_records/i.test(sql)) {
          return {
            rows: [
              {
                username: 'alice',
                store: '洪潮',
                check_time: '2026-07-05T10:00:00+08:00',
                status: 'ok',
              },
            ],
          };
        }
        if (/approval_requests/i.test(sql)) {
          return { rows: [{ id: 'appr-rp-1', ym: '2026-07' }] };
        }
        return { rows: [] };
      },
    }),
    ctxExtra: {
      buildAttendanceFromCheckinRecords: () => [
        { store: '洪潮', username: 'alice', name: '爱丽丝', days: 22 },
      ],
      findUserSalary: (_s, u) => (u === 'alice' || u === 'bob' ? 5400 : null),
      calcEmployeeMonthlyLeaveBalance: () => ({ remaining: 2 }),
      stateFindUserRecord: (_s, u) => {
        if (String(u).toLowerCase() === 'bob') {
          return { username: 'bob', name: '鲍勃', store: '洪潮' };
        }
        return null;
      },
    },
  });

  const result = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '洪潮',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.engine, 'legacy_fallback');
  assert.ok(result.payload.rows.length >= 2);
  const alice = result.payload.rows.find((r) => r.username === 'alice');
  assert.ok(alice);
  assert.equal(alice.baseAmount, 999);
  assert.equal(alice.baseAmountOverridden, true);
  assert.ok(alice.subsidy >= 50);
  const bob = result.payload.rows.find((r) => r.username === 'bob');
  assert.ok(bob);
  assert.equal(bob.rewardPunishmentAdj, 100);
  assert.equal(result.payload.audit.audited, true);
});

test('getPayrollReportPayload: legacy checkin 失败回落日报；倒欠假期全勤', async () => {
  const { ctx } = baseCtx({
    state: {
      employees: [{ username: 'alice', name: '爱丽丝', store: '洪潮', status: 'active' }],
      dailyReports: [{ date: '2026-07-03', store: '洪潮', staff: {} }],
    },
    pool: makePool({
      query: async (sql) => {
        if (/checkin_records/i.test(sql)) throw new Error('checkin_down');
        if (/approval_requests/i.test(sql)) throw new Error('ar_down');
        return { rows: [] };
      },
    }),
    ctxExtra: {
      buildAttendanceFromReports: () => [
        { store: '洪潮', username: 'alice', name: '爱丽丝', days: 20 },
      ],
      findUserSalary: () => 5400,
      calcEmployeeMonthlyLeaveBalance: () => ({ remaining: -1 }),
    },
  });
  const result = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '洪潮',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.engine, 'legacy_fallback');
  assert.equal(result.payload.rows[0].payableAttendanceDays, result.payload.workDaysPerMonth);
});

test('auditPayrollMonth / adjustPayrollRow：校验与成功写账本', async () => {
  const { ctx: c1 } = baseCtx({ state: {} });
  assert.equal((await auditPayrollMonth(c1, { month: '2026-07', username: '' })).error, 'missing_user');

  const ledgerCalls = [];
  const { ctx } = baseCtx({
    state: { payrollAdjustments: {} },
    upsertPayrollLedgerEntry: async (payload) => {
      ledgerCalls.push(payload);
      return { ok: true };
    },
  });
  const adj = await adjustPayrollRow(ctx, {
    month: '2026-07',
    store: '洪潮',
    targetUsername: 'alice',
    subsidy: 80,
    baseAmount: 1200,
    reason: '高温补贴',
    username: 'boss',
    tenantId: 'default',
  });
  assert.equal(adj.ok, true);
  assert.equal(adj.item.subsidy, 80);
  assert.equal(adj.item.baseAmount, 1200);
  assert.equal(ledgerCalls.length, 1);
  assert.equal(ledgerCalls[0].entryType, 'manual_subsidy');
  assert.equal(ledgerCalls[0].amount, 80);

  assert.equal(
    (await adjustPayrollRow(ctx, {
      month: '',
      targetUsername: 'alice',
      subsidy: 1,
      username: 'boss',
    })).error,
    'missing_month'
  );
  assert.equal(
    (await adjustPayrollRow(ctx, {
      month: '2026-07',
      targetUsername: '',
      subsidy: 1,
      username: 'boss',
    })).error,
    'missing_username'
  );
});

test('getPayrollReportPayload: closed_loop 仅 users + leave 汇总；adjust ledger 失败仍成功', async () => {
  const { ctx } = baseCtx({
    state: {
      users: [{ username: 'uOnly', name: '仅用户', store: '洪潮', status: 'active' }],
    },
    buildPayrollForMonth: async ({ people, leaveBalanceByUser }) => {
      assert.equal(people[0].username, 'uOnly');
      assert.equal(leaveBalanceByUser.get('uonly'), 3);
      return {
        ok: true,
        monthDays: 31,
        workDaysPerMonth: 27,
        rows: [{
          store: '洪潮',
          username: 'uOnly',
          name: '仅用户',
          attendanceDays: 5,
          payableAttendanceDays: 5,
          workDaysPerMonth: 27,
          leaveRemaining: 3,
          monthlySalary: 2000,
          dailyRate: 74,
          baseAmount: 370,
          rewardPunishmentAdj: 0,
          subsidy: 0,
          pointsAmount: 0,
          manualSubsidy: 0,
          amount: 370,
          prorationMode: 'attendance',
          salarySource: 'profile',
          ledgerItems: [],
          attendanceSummary: null,
        }],
        rules: {},
        monthRun: null,
        resolvedFrom: {},
      };
    },
    ctxExtra: {
      calcEmployeeMonthlyLeaveBalance: () => ({ remaining: 3 }),
      summarizeAttendanceDaysForMonth: async () => ({ restDays: 1 }),
    },
  });
  const r = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '洪潮',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });
  assert.equal(r.ok, true);
  assert.equal(r.payload.rows[0].username, 'uOnly');

  const { ctx: adjCtx } = baseCtx({
    state: {},
    upsertPayrollLedgerEntry: async () => {
      throw new Error('ledger_boom');
    },
  });
  const adj = await adjustPayrollRow(adjCtx, {
    month: '2026-07',
    store: '洪潮',
    targetUsername: 'alice',
    subsidy: 10,
    username: 'boss',
  });
  assert.equal(adj.ok, true);
});

test('getPayrollReportPayload: legacy 空 state 走 db 员工 + users 合并', async () => {
  const { ctx } = baseCtx({
    state: {
      users: [{ username: 'fromUser', name: '用户侧', store: '洪潮', status: 'active' }],
    },
    dbEmployees: [],
    pool: makePool({
      query: async (sql) => {
        if (/checkin_records/i.test(sql)) return { rows: [] };
        if (/approval_requests/i.test(sql)) return { rows: [] };
        return { rows: [] };
      },
    }),
    ctxExtra: {
      findUserSalary: (_s, u) => (u === 'fromUser' ? 4000 : null),
      calcEmployeeMonthlyLeaveBalance: () => ({ remaining: 0 }),
      buildAttendanceFromCheckinRecords: () => [],
    },
  });
  const result = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '洪潮',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload.engine, 'legacy_fallback');
  assert.ok(result.payload.rows.some((r) => r.username === 'fromUser'));
});

test('getPayrollReportPayload / audit / adjust：顶层 500', async () => {
  const { ctx } = baseCtx({
    ctxExtra: {
      getSharedState: async () => {
        throw new Error('state_boom');
      },
    },
  });
  const r1 = await getPayrollReportPayload(ctx, {
    month: '2026-07',
    storeQ: '',
    role: 'admin',
    username: 'boss',
    tenantId: 'default',
    allowedStores: [],
    currentStore: '',
  });
  assert.equal(r1.ok, false);
  assert.equal(r1.status, 500);

  // auditPayrollMonth/adjustPayrollRow 现在直接走 pool（不再依赖 getSharedState），
  // 用 pool.connect() 抛错来模拟它们真正会失败的路径。
  const { ctx: dbDownCtx } = baseCtx({
    pool: { ...makePool(), connect: async () => { throw new Error('db_boom'); } },
  });

  const r2 = await auditPayrollMonth(dbDownCtx, {
    month: '2026-07',
    store: '洪潮',
    username: 'boss',
    audited: true,
  });
  assert.equal(r2.status, 500);

  const r3 = await adjustPayrollRow(dbDownCtx, {
    month: '2026-07',
    store: '洪潮',
    targetUsername: 'alice',
    subsidy: 1,
    username: 'boss',
  });
  assert.equal(r3.status, 500);
});
