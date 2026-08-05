import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPosSalesCheckWindow,
  isLeaveCumulativeSnapshotWindow,
  isPastMonthlyPerformanceCloseWindow,
  findMissingPosStores,
  expectedStoresFromState,
  createListenMonitors,
} from '../startup-monitors.js';

test('isPosSalesCheckWindow: 23:30–23:34 only', () => {
  const d = new Date();
  d.setHours(23, 30, 0, 0);
  assert.equal(isPosSalesCheckWindow(d), true);
  d.setHours(23, 34, 0, 0);
  assert.equal(isPosSalesCheckWindow(d), true);
  d.setHours(23, 35, 0, 0);
  assert.equal(isPosSalesCheckWindow(d), false);
  d.setHours(22, 30, 0, 0);
  assert.equal(isPosSalesCheckWindow(d), false);
});

test('isLeaveCumulativeSnapshotWindow', () => {
  const parts = (day, hour, minute) => [
    { type: 'day', value: day },
    { type: 'hour', value: hour },
    { type: 'minute', value: minute },
  ];
  assert.equal(isLeaveCumulativeSnapshotWindow(parts('01', '6', '0')), true);
  assert.equal(isLeaveCumulativeSnapshotWindow(parts('01', '6', '14')), true);
  assert.equal(isLeaveCumulativeSnapshotWindow(parts('01', '6', '15')), false);
  assert.equal(isLeaveCumulativeSnapshotWindow(parts('02', '6', '0')), false);
});

test('isPastMonthlyPerformanceCloseWindow', () => {
  assert.equal(isPastMonthlyPerformanceCloseWindow(9, 23), false);
  assert.equal(isPastMonthlyPerformanceCloseWindow(10, 1), false);
  assert.equal(isPastMonthlyPerformanceCloseWindow(10, 2), true);
  assert.equal(isPastMonthlyPerformanceCloseWindow(11, 0), true);
});

test('expectedStoresFromState + findMissingPosStores', () => {
  const expected = expectedStoresFromState({
    employees: [
      { role: 'store_manager', store: '洪潮大宁久光店', status: '在职' },
      { role: 'store_manager', store: '马己仙', status: '离职' },
      { role: 'admin', store: '总部', status: '在职' },
    ],
    users: [{ role: 'store_manager', store: '测试店', status: 'active' }],
  });
  assert.deepEqual(expected.sort(), ['洪潮大宁久光店', '测试店'].sort());
  const missing = findMissingPosStores(expected, ['洪潮大宁久光店']);
  assert.deepEqual(missing, ['测试店']);
  assert.deepEqual(findMissingPosStores(['洪潮'], ['洪潮大宁']), []);
});

test('createListenMonitors: beatHeartbeat + start wires intervals', async () => {
  const timers = [];
  const timeouts = [];
  let beats = 0;
  let state = {
    employees: [{ role: 'store_manager', store: '洪潮大宁久光店', status: '在职' }],
    dailyReports: [{ date: '2026-06-01', store: '洪潮大宁久光店', data: { actual: 1 } }],
    pointRecords: [],
  };
  const pool = {
    query: async (sql, _params) => {
      const s = String(sql);
      if (/INSERT INTO scheduler_heartbeat/i.test(s)) {
        beats += 1;
        return { rows: [], rowCount: 1 };
      }
      if (/CREATE TABLE IF NOT EXISTS scheduler_heartbeat/i.test(s)) return { rows: [] };
      // 2026-08-05：心跳检查改为注册表驱动（scheduler-registry.js），SQL 从
      // "算好 minutes_ago" 变成 "取原始 last_beat/status 再在内存里判定"。
      // cache_purge 给一个远超阈值(390分钟)的 last_beat，用来断言 overdue 会告警。
      // 只匹配全表扫描那条（含 duration_ms）；wasRecentlyFiredPersisted 的
      // `SELECT last_beat ... WHERE task_name = $1` 必须继续走空结果，否则去重逻辑
      // 会误判成"刚刚已告警过"，把 POS 销售缺失等告警一并吞掉。
      if (/FROM scheduler_heartbeat/i.test(s) && /duration_ms/i.test(s)) {
        return {
          rows: [{
            task_name: 'cache_purge',
            last_beat: new Date(Date.now() - 999 * 60 * 1000).toISOString(),
            status: 'ok',
            last_error: null,
            duration_ms: null,
            last_success_at: new Date(Date.now() - 999 * 60 * 1000).toISOString(),
          }],
        };
      }
      if (/MAX\(date\)/i.test(s) && /daily_reports/i.test(s)) {
        return { rows: [{ latest: '2026-07-01' }] };
      }
      if (/FROM daily_reports/i.test(s) && /ORDER BY date DESC/i.test(s)) {
        return {
          rows: [
            {
              store: '洪潮大宁久光店',
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
              submitted_at: '2026-07-01T00:00:00Z',
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
        };
      }
      if (/jsonb_set/i.test(s) && /dailyReports/i.test(s)) return { rowCount: 1 };
      if (/COUNT\(\*\)::int AS c FROM point_records/i.test(s)) return { rows: [{ c: 2 }] };
      if (/FROM point_records/i.test(s) && /ORDER BY/i.test(s)) {
        return {
          rows: [
            {
              id: '1',
              approval_id: null,
              username: 'u1',
              name: 'U1',
              store: 'S',
              item_name: 'x',
              reason: 'r',
              points: 1,
              amount: 0,
              approved_at: null,
              approved_by: '',
            },
            {
              id: '2',
              approval_id: null,
              username: 'u2',
              name: 'U2',
              store: 'S',
              item_name: 'y',
              reason: 'r',
              points: 2,
              amount: 0,
              approved_at: null,
              approved_by: '',
            },
          ],
        };
      }
      if (/FROM agent_scores/i.test(s)) return { rows: [{ c: 0 }] };
      if (/FROM pos_sales_detail/i.test(s)) return { rows: [{ store: '其他店' }] };
      if (/DELETE FROM agent_long_memory/i.test(s)) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const alerts = [];
  const { beatHeartbeat, startListenMonitors } = createListenMonitors({
    pool,
    runForActiveTenants: async (fn) => {
      await fn('default');
      return { results: ['default'], errors: [] };
    },
    runWithBootstrapTenantContext: async (fn) => fn(),
    tenantContext: { run: async (_t, fn) => fn() },
    getSharedState: async () => state,
    mergeSharedStateFields: async (patch) => {
      state = { ...state, ...patch };
    },
    purgeExpiredCache: async () => {},
    sendAdminSystemAlert: async (msg) => {
      alerts.push(msg);
    },
    upsertLeaveDomainFromState: async () => {},
    upsertPayrollDomainFromState: async () => {},
    getExpectedMonthlyPerformancePeriodShanghai: () => '2026-06',
    countEligibleMonthlyPerformanceUsers: async () => 5,
    leaveAttendanceHelpers: {
      shiftMonth: () => '2026-06',
      runLeaveCumulativeCloseSnapshotForClosedMonth: async () => ({
        ok: false,
        error: 'boom',
        closedMonth: '2026-06',
      }),
    },
    safeErrMessage: (e) => String(e?.message || e),
    hrmsNowISO: () => '2026-07-01T00:00:00+08:00',
    allowSchemaChanges: true,
    setIntervalFn: (fn, ms) => {
      timers.push({ fn, ms });
      return 1;
    },
    setTimeoutFn: (fn, ms) => {
      timeouts.push({ fn, ms });
      return 1;
    },
  });

  await beatHeartbeat('cache_purge');
  assert.ok(beats >= 1);

  await startListenMonitors();
  assert.ok(timers.length >= 5);
  assert.ok(timeouts.some((t) => t.ms === 15 * 1000));

  const hbTick = timers.find((t) => t.ms === 30 * 60 * 1000);
  assert.ok(hbTick);
  await hbTick.fn();
  assert.ok(alerts.some((a) => String(a).includes('定时任务心跳异常')));

  const cacheTick = timers.find((t) => t.ms === 2 * 60 * 60 * 1000);
  assert.ok(cacheTick);
  await cacheTick.fn();

  const reconcileTick = timers.find((t) => t.ms === 10 * 60 * 1000);
  assert.ok(reconcileTick);
  await reconcileTick.fn();
  // monitor-critical-reconcile.js 不再直接 jsonb_set 回灌 blob（表已 hydrate 收口进
  // getSharedState），落后时只 invalidate 缓存 + 告警，告警文案里已经去掉了"自愈"二字。
  assert.ok(alerts.some((a) => String(a).includes('核心数据')));

  // Force POS sales window by monkey-patching Date temporarily via real local 23:30
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super();
        this.setHours(23, 32, 0, 0);
        return;
      }
      super(...args);
    }
    static now() {
      return new FakeDate().getTime();
    }
  }
  globalThis.Date = FakeDate;
  try {
    const salesTick = timers.find((t) => t.ms === 5 * 60 * 1000);
    assert.ok(salesTick);
    await salesTick.fn();
    assert.ok(alerts.some((a) => String(a).includes('销售数据缺失')));
  } finally {
    globalThis.Date = RealDate;
  }

  // leave cumulative: stub Intl to return day=01 hour=6
  const realFmt = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (...args) {
    const inst = new realFmt(...args);
    return {
      formatToParts: () => [
        { type: 'year', value: '2026' },
        { type: 'month', value: '07' },
        { type: 'day', value: '01' },
        { type: 'hour', value: '6' },
        { type: 'minute', value: '05' },
      ],
      format: (...a) => inst.format(...a),
    };
  };
  try {
    const leaveTick = timers.find((t) => t.ms === 60 * 1000);
    assert.ok(leaveTick);
    await leaveTick.fn();
    assert.ok(alerts.some((a) => String(a).includes('累计假期')));
  } finally {
    Intl.DateTimeFormat = realFmt;
  }

  // session purge hourly
  const purgeTick = timers.find((t) => t.ms === 60 * 60 * 1000);
  assert.ok(purgeTick);
  await purgeTick.fn();
});

test('createListenMonitors: schema skip + alert swallow', async () => {
  const timers = [];
  let alertCalls = 0;
  const { startListenMonitors } = createListenMonitors({
    pool: {
      query: async () => {
        throw new Error('db');
      },
    },
    runForActiveTenants: async () => ({ results: [], errors: [] }),
    runWithBootstrapTenantContext: async (fn) => fn(),
    tenantContext: { run: async (_t, fn) => fn() },
    getSharedState: async () => ({}),
    mergeSharedStateFields: async () => {},
    purgeExpiredCache: async () => {},
    sendAdminSystemAlert: async () => {
      alertCalls += 1;
      throw new Error('alert_fail');
    },
    upsertLeaveDomainFromState: async () => {},
    upsertPayrollDomainFromState: async () => {},
    getExpectedMonthlyPerformancePeriodShanghai: () => '2026-06',
    countEligibleMonthlyPerformanceUsers: async () => 0,
    leaveAttendanceHelpers: {
      shiftMonth: () => null,
      runLeaveCumulativeCloseSnapshotForClosedMonth: async () => ({ ok: true }),
    },
    safeErrMessage: (e) => String(e?.message || e),
    allowSchemaChanges: false,
    setIntervalFn: (fn, ms) => {
      timers.push({ fn, ms });
      return 1;
    },
    setTimeoutFn: () => 1,
  });
  await startListenMonitors();
  const hbTick = timers.find((t) => t.ms === 30 * 60 * 1000);
  // force stale via query throw inside runWithBootstrap — still non-fatal
  await hbTick.fn();
  assert.equal(typeof alertCalls, 'number');
});
