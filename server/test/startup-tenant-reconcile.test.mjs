import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDailyReportsForStartup,
  mergePointRecordsForStartup,
  createStartupTenantReconcileRunner,
} from '../domains/shared/startup-tenant-reconcile.js';

test('mergeDailyReportsForStartup: keeps state detail + drafts', () => {
  const dbItems = [
    { date: '2026-07-01', store: '洪潮', data: { actual: 100, segments: {} } },
  ];
  const existing = [
    {
      date: '2026-07-01',
      store: '洪潮',
      data: { actual: 1, segments: { lunch: 1 }, photos: ['a.jpg'] },
    },
    { date: '2026-07-02', store: '洪潮', data: { actual: 50 } }, // draft
  ];
  const { finalMerged, stateOnlyItems } = mergeDailyReportsForStartup(dbItems, existing);
  assert.equal(stateOnlyItems.length, 1);
  assert.equal(finalMerged.length, 2);
  const merged = finalMerged.find((x) => x.date === '2026-07-01');
  assert.equal(merged.data.actual, 100);
  assert.deepEqual(merged.data.segments, { lunch: 1 });
  assert.deepEqual(merged.data.photos, ['a.jpg']);
});

test('mergeDailyReportsForStartup: does not overwrite non-empty DB detail', () => {
  const dbItems = [
    { date: '2026-07-01', store: 'A', data: { segments: { a: 1 }, photos: [] } },
  ];
  const existing = [
    { date: '2026-07-01', store: 'A', data: { segments: { b: 2 }, photos: ['x'] } },
  ];
  const { finalMerged } = mergeDailyReportsForStartup(dbItems, existing);
  assert.deepEqual(finalMerged[0].data.segments, { a: 1 });
  assert.deepEqual(finalMerged[0].data.photos, ['x']);
});

test('mergePointRecordsForStartup: DB wins + keep state-only ids', () => {
  const db = [{ id: '1', points: 10 }];
  const existing = [
    { id: '1', points: 99 },
    { id: 'orphan', points: 3 },
    { points: 1 }, // no id — dropped
  ];
  const { mergedPr, stateOnlyPr } = mergePointRecordsForStartup(db, existing);
  assert.equal(stateOnlyPr.length, 1);
  assert.equal(mergedPr.length, 2);
  assert.equal(mergedPr[0].points, 10);
  assert.equal(mergedPr[1].id, 'orphan');
});

function mockPool(handlers) {
  return {
    query: async (sql, params) => {
      const s = String(sql);
      for (const h of handlers) {
        if (h.match.test(s)) return h.fn(s, params);
      }
      return { rows: [], rowCount: 0 };
    },
    connect: async () => {
      const client = {
        query: async (sql, _params) => {
          const s = String(sql);
          if (/BEGIN|COMMIT|ROLLBACK/i.test(s)) return { rows: [] };
          if (/SELECT data FROM hrms_state/i.test(s)) {
            return { rows: [{ data: { dailyReports: [], pointRecords: [] } }] };
          }
          if (/UPDATE hrms_state/i.test(s)) return { rows: [], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
      return client;
    },
  };
}

test('runStartupTenantReconcile: smoke path with mocked pool', async () => {
  let state = {
    dailyReports: [{ date: '2026-07-02', store: 'S1', data: { actual: 1 } }],
    pointRecords: [{ id: 'orphan', points: 2 }],
    leaveRecords: [],
    salaryAdjustments: [],
    notifications: [],
    employees: [{ username: 'u1', name: 'U1' }],
  };

  const pool = mockPool([
    {
      match: /FROM daily_reports/i,
      fn: () => ({
        rows: [
          {
            store: 'S1',
            date: '2026-07-01',
            brand: '洪潮',
            actual_revenue: 100,
            pre_discount_revenue: 110,
            total_discount: 10,
            dine_orders: 1,
            dine_revenue: 100,
            dine_traffic: 1,
            efficiency: 0,
            labor_total: 0,
            actual_margin: 0,
            gross_profit: 0,
            dianping_rating: null,
            new_wechat_members: 0,
            wechat_month_total: 0,
            private_room_uses: 0,
            operational_anomaly_note: null,
            delivery_pre_revenue: 0,
            delivery_actual: 0,
            delivery_orders: 0,
            delivery_bad_reviews: 0,
            budget: 0,
            budget_rate: 0,
            submitted: true,
            submitted_at: null,
            updated_at: null,
            recharge_count: 0,
            recharge_amount: 0,
            weather: null,
            segments: null,
            discount_dine: 0,
            discount_delivery: 0,
            categories: null,
            delivery_detail: null,
            bad_reviews_dianping: 0,
            staff: null,
            schedule_next_day: null,
            photos: null,
            holiday_switch: false,
          },
        ],
      }),
    },
    {
      match: /FROM point_records/i,
      fn: () => ({
        rows: [
          {
            id: '1',
            approval_id: null,
            username: 'u1',
            name: 'U1',
            store: 'S1',
            item_name: 'x',
            reason: 'r',
            points: 5,
            amount: 0,
            approved_at: null,
            approved_by: '',
          },
        ],
      }),
    },
    {
      match: /INSERT INTO employee_attendance_records/i,
      fn: () => ({ rowCount: 0 }),
    },
    {
      match: /INSERT INTO checkin_records/i,
      fn: () => ({ rowCount: 0 }),
    },
    {
      match: /FROM hrms_payroll_domain/i,
      fn: () => ({
        rows: [
          {
            id: 'default',
            payroll_adjustments: [{ id: 'pa1' }],
            payroll_audits: [],
            salary_adjustments: [],
            monthly_confirmations: [],
          },
        ],
      }),
    },
    {
      match: /FROM hrms_leave_domain/i,
      fn: () => ({
        rows: [
          {
            id: 'default',
            leave_balance_overrides: { u1: 1 },
            leave_balance_adjustments: [],
            leave_cumulative_close_snapshots: [],
          },
        ],
      }),
    },
    {
      match: /FROM hrms_leave_records/i,
      fn: () => ({
        rows: [
          {
            id: 'L1',
            username: 'u1',
            name: 'U1',
            store: 'S1',
            brand: '',
            start_date: '2026-07-01',
            end_date: '2026-07-02',
            days: 1,
            type: 'leave',
            reason: '',
            created_at: '2026-07-01',
            status: 'approved',
          },
        ],
      }),
    },
    {
      match: /FROM hrms_reward_punishment_records/i,
      fn: () => ({
        rows: [
          {
            id: 'RP1',
            approval_id: null,
            username: 'u1',
            name: 'U1',
            type: 'reward',
            amount: 100,
            reason: 'good',
            created_by: 'admin',
            created_at: '2026-07-01',
          },
        ],
      }),
    },
    {
      match: /FROM approval_requests/i,
      fn: () => ({ rows: [{ cnt: '2' }] }),
    },
    {
      match: /FROM hrms_user_notifications/i,
      fn: () => ({
        rows: [
          {
            id: 'N1',
            target_username: 'u1',
            title: 't',
            message: 'm',
            type: 'performance_deduction',
            meta: {},
            created_at: '2026-07-01',
          },
        ],
      }),
    },
    {
      match: /SELECT id::text FROM hrms_leave_records/i,
      fn: () => ({ rows: [{ id: 'L1' }] }),
    },
    {
      match: /SELECT id::text FROM hrms_reward_punishment_records/i,
      fn: () => ({ rows: [{ id: 'RP1' }] }),
    },
    {
      match: /UPDATE daily_reports SET/i,
      fn: () => ({ rowCount: 1 }),
    },
    {
      match: /INSERT INTO hrms_leave_records/i,
      fn: () => ({ rowCount: 1 }),
    },
    {
      match: /INSERT INTO hrms_reward_punishment_records/i,
      fn: () => ({ rowCount: 1 }),
    },
    {
      match: /UPDATE hrms_state/i,
      fn: (_s, params) => {
        if (params?.[1]) {
          try {
            state = { ...state, ...JSON.parse(params[1]) };
          } catch {
            /* ignore */
          }
        }
        return { rowCount: 1 };
      },
    },
  ]);

  const run = createStartupTenantReconcileRunner({
    pool,
    runForActiveTenants: async (fn, opts) => {
      try {
        await fn('default');
        return { results: ['default'], errors: [] };
      } catch (error) {
        opts?.onError?.({ tenantId: 'default', error });
        return { results: [], errors: [{ tenantId: 'default', error }] };
      }
    },
    getSharedState: async () => state,
    mergeSharedStateFields: async (patch) => {
      state = { ...state, ...patch };
    },
    tenantContext: { run: async (_tid, fn) => fn() },
    upsertPayrollDomainFromState: async () => {},
    upsertLeaveDomainFromState: async () => {},
    upsertEmployeesFromStateShape: async () => 1,
    loadEmployeesFromTable: async () => [{ username: 'u2', name: 'U2' }],
    hrmsNowISO: () => '2026-07-01T00:00:00+08:00',
    toNullableUuid: () => null,
    resolveTenantIdDefault: () => 'default',
    backfillDailyAttendanceRegisterMissing: async () => ({ scanned: 1, reconciled: 1 }),
    dedupeGlobalSocialMediaPointRules: async () => {},
    ensureGlobalSocialMediaPointRule: async () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  const summary = await run();
  assert.equal(summary.results.length, 1);
  assert.equal(summary.errors.length, 0);
});

test('runStartupTenantReconcile: step failures stay non-fatal', async () => {
  const pool = {
    query: async () => {
      throw new Error('db_down');
    },
    connect: async () => {
      throw new Error('no_conn');
    },
  };
  const run = createStartupTenantReconcileRunner({
    pool,
    runForActiveTenants: async (fn) => {
      await fn('default');
      return { results: ['default'], errors: [] };
    },
    getSharedState: async () => ({}),
    mergeSharedStateFields: async () => {},
    tenantContext: { run: async (_t, fn) => fn() },
    upsertPayrollDomainFromState: async () => {
      throw new Error('pay');
    },
    upsertLeaveDomainFromState: async () => {
      throw new Error('leave');
    },
    upsertEmployeesFromStateShape: async () => {
      throw new Error('emp');
    },
    loadEmployeesFromTable: async () => [],
    hrmsNowISO: () => 't',
    toNullableUuid: () => null,
    resolveTenantIdDefault: () => 'default',
    backfillDailyAttendanceRegisterMissing: async () => {
      throw new Error('bf');
    },
    dedupeGlobalSocialMediaPointRules: async () => {},
    ensureGlobalSocialMediaPointRule: async () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });
  const summary = await run();
  assert.equal(summary.results.length, 1);
});
