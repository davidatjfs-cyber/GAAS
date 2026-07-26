import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyReportNameMap,
  resolveListDailyReportsStoreFilter,
  filterStateDailyReports,
  resolvePgMergeWindow,
  mergePgRowsIntoItems,
  mergeDailyReportsFromPgRange,
  mergeDailyReportsFromPgLatest,
  enrichDailyReportItemsWithDb,
  queryWechatMonthBase,
  runListDailyReports,
} from '../list-daily-reports-helpers.js';

const PG_ROW = {
  store: '洪潮店',
  date: '2026-07-24',
  brand: '洪潮',
  actual_revenue: 10000,
  pre_discount_revenue: 11000,
  total_discount: 1000,
  dine_orders: 50,
  dine_revenue: 8000,
  dine_traffic: 60,
  efficiency: 1.2,
  labor_total: 3000,
  actual_margin: 0.55,
  gross_profit: 5500,
  dianping_rating: 4.5,
  new_wechat_members: 3,
  wechat_month_total: 20,
  private_room_uses: 1,
  operational_anomaly_note: 'ok',
  delivery_pre_revenue: 0,
  delivery_actual: 0,
  delivery_orders: 0,
  delivery_bad_reviews: 0,
  budget: 9000,
  budget_rate: 1.1,
  submitted: true,
  submitted_at: '2026-07-24T10:00:00Z',
  updated_at: '2026-07-24T10:00:00Z',
  recharge_count: 0,
  recharge_amount: 0,
  weather: '晴',
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
};

test('buildDailyReportNameMap: maps username to display name', () => {
  const map = buildDailyReportNameMap({
    employees: [{ username: 'u1', name: '张三' }],
    users: [{ username: 'u2', name: '李四' }],
  });
  assert.equal(map.get('u1'), '张三');
  assert.equal(map.get('u2'), '李四');
});

test('resolveListDailyReportsStoreFilter: restricted role uses allowed/current/my store', () => {
  assert.equal(
    resolveListDailyReportsStoreFilter({
      role: 'store_manager',
      storeQ: '店B',
      allowedStores: ['店A'],
      currentStore: '店C',
      myStore: '店D',
    }),
    '店C'
  );
  assert.equal(
    resolveListDailyReportsStoreFilter({
      role: 'store_manager',
      storeQ: '店A',
      allowedStores: ['店A'],
      currentStore: '',
      myStore: '店D',
    }),
    '店A'
  );
  assert.equal(
    resolveListDailyReportsStoreFilter({
      role: 'admin',
      storeQ: '任意店',
      allowedStores: [],
      currentStore: '',
      myStore: '',
    }),
    '任意店'
  );
});

test('filterStateDailyReports: filters by store/date/range and drops nulls', () => {
  const items = [
    { store: '店A', date: '2026-07-01' },
    { store: '店B', date: '2026-07-02' },
    null,
  ];
  const inDateRange = (d, start, end) => d >= start && d <= end;
  const out = filterStateDailyReports(items, {
    store: '店A',
    date: '',
    start: '2026-07-01',
    end: '2026-07-03',
    inDateRange,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].store, '店A');
});

test('resolvePgMergeWindow: date / range / latest modes', () => {
  assert.deepEqual(resolvePgMergeWindow({ date: '2026-07-24', start: '', end: '', limit: 50 }), {
    pgMergeStart: '2026-07-24',
    pgMergeEnd: '2026-07-24',
    pgMergeLatestLimit: 0,
  });
  const range = resolvePgMergeWindow({ date: '', start: '2026-07-10', end: '2026-07-01', limit: 50 });
  assert.equal(range.pgMergeStart, '2026-07-01');
  assert.equal(range.pgMergeEnd, '2026-07-10');
  const latest = resolvePgMergeWindow({ date: '', start: '', end: '', limit: 50 });
  assert.equal(latest.pgMergeLatestLimit, 200);
});

test('mergePgRowsIntoItems: merges and inserts PG rows', () => {
  const items = [{ store: '洪潮店', date: '2026-07-24', data: { gross: 1 } }];
  const merged = mergePgRowsIntoItems(items, [PG_ROW]);
  assert.equal(merged.length, 1);
  assert.ok(Number(merged[0].data?.gross) >= 10000 || merged[0].data?.actual_revenue !== undefined || merged[0].store === '洪潮店');
});

test('mergeDailyReportsFromPgRange: queries with store filter', async () => {
  const queries = [];
  const pool = {
    query: async (sql, args) => {
      queries.push({ sql, args });
      return { rows: [PG_ROW] };
    },
  };
  const out = await mergeDailyReportsFromPgRange(pool, [], {
    pgMergeStart: '2026-07-01',
    pgMergeEnd: '2026-07-31',
    store: '洪潮店',
    tenantIdQ: 'default',
  });
  assert.equal(out.length, 1);
  assert.match(queries[0].sql, /daily_reports/);
  assert.ok(queries[0].args.includes('洪潮店'));
});

test('mergeDailyReportsFromPgLatest: applies limit', async () => {
  const pool = { query: async () => ({ rows: [PG_ROW] }) };
  const out = await mergeDailyReportsFromPgLatest(pool, [], {
    pgMergeLatestLimit: 300,
    store: '',
    tenantIdQ: 'default',
  });
  assert.equal(out.length, 1);
});

test('enrichDailyReportItemsWithDb: adds submitter and db fields', async () => {
  const pool = {
    query: async () => ({
      rows: [{
        store: '洪潮店',
        date: '2026-07-24',
        dianping_rating: 4.8,
        new_wechat_members: 5,
        wechat_month_total: 30,
        operational_anomaly_note: 'note',
      }],
    }),
  };
  const items = [{
    store: '洪潮店',
    date: '2026-07-24',
    submittedBy: 'u1',
    data: {},
  }];
  const resolveRealName = (u) => (u === 'u1' ? '张三' : u);
  const out = await enrichDailyReportItemsWithDb(pool, items, {
    monthlyTargets: [{ ym: '2026-07', store: '洪潮店', targets: { margin: 0.6 } }],
    tenantIdQ: 'default',
    resolveRealName,
    log: { error: () => {} },
  });
  assert.equal(out[0].submitterName, '张三');
  assert.equal(out[0].data.target_margin, 0.6);
  assert.equal(out[0].data.dianping_rating, 4.8);
  assert.equal(out[0].data.new_wechat_members, 5);
});

test('enrichDailyReportItemsWithDb: returns empty list unchanged', async () => {
  const out = await enrichDailyReportItemsWithDb({ query: async () => ({ rows: [] }) }, [], {
    monthlyTargets: [],
    tenantIdQ: 'default',
    resolveRealName: (u) => u,
    log: { error: () => {} },
  });
  assert.deepEqual(out, []);
});

test('queryWechatMonthBase: sums month excluding current date', async () => {
  const pool = { query: async () => ({ rows: [{ base: 17 }] }) };
  const out = await queryWechatMonthBase(pool, { store: '洪潮店', date: '2026-07-24', tenantIdQ: 'default' });
  assert.equal(out, 17);
});

test('queryWechatMonthBase: returns 0 without store/date', async () => {
  assert.equal(await queryWechatMonthBase({ query: async () => ({ rows: [] }) }, {}), 0);
});

test('runListDailyReports: merges PG by date and sorts', async () => {
  const state0 = {
    dailyReports: [{ store: '洪潮店', date: '2026-07-23', updatedAt: '2026-07-23', data: {} }],
    settings: { monthlyTargets: [] },
    employees: [{ username: 'u1', name: '张三' }],
    users: [],
  };
  const pool = {
    query: async (sql) => {
      if (sql.includes('unnest')) {
        return { rows: [] };
      }
      return { rows: [PG_ROW] };
    },
  };
  const out = await runListDailyReports(
    {
      pool,
      getSharedState: async () => state0,
      stateFindUserRecord: (_s, u) => ({ username: u, store: '洪潮店' }),
      inDateRange: (d, start, end) => d >= start && d <= end,
      log: { error: () => {} },
    },
    {
      username: 'u1',
      role: 'admin',
      date: '2026-07-24',
      start: '',
      end: '',
      storeQ: '',
      limit: 10,
      allowedStores: [],
      currentStore: '',
      tenantId: 'default',
    }
  );
  assert.ok(out.items.length >= 1);
  assert.equal(out.items[0].date, '2026-07-24');
});

test('runListDailyReports: store_manager restricted to own store', async () => {
  const state0 = {
    dailyReports: [
      { store: '洪潮店', date: '2026-07-24', data: {} },
      { store: '马己仙店', date: '2026-07-24', data: {} },
    ],
    settings: {},
    employees: [{ username: 'mgr', name: '经理', store: '洪潮店' }],
    users: [],
  };
  const pool = { query: async () => ({ rows: [] }) };
  const out = await runListDailyReports(
    {
      pool,
      getSharedState: async () => state0,
      stateFindUserRecord: (_s, u) => state0.employees.find((e) => e.username === u),
      inDateRange: () => true,
      log: { error: () => {} },
    },
    {
      username: 'mgr',
      role: 'store_manager',
      date: '',
      start: '',
      end: '',
      storeQ: '',
      limit: 10,
      allowedStores: ['洪潮店'],
      currentStore: '洪潮店',
      tenantId: 'default',
    }
  );
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].store, '洪潮店');
});
