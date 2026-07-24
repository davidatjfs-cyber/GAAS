import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listDailyReports,
  queryPrivateRoomMonthTotal,
  deleteDailyReportFromState,
  syncSubmittedDailyReportsToPg,
  upsertDailyReport,
} from '../domains/daily-reports/service.js';
import { bindDailyReportsRuntimeDeps } from '../domains/daily-reports/helpers.js';

function makeListDeps(overrides = {}) {
  const queries = [];
  const pool = {
    query: async (...a) => {
      queries.push(a);
      if (overrides.poolQuery) return overrides.poolQuery(...a);
      return { rows: [] };
    },
  };
  bindDailyReportsRuntimeDeps({
    pool,
    hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    safeDateOnly: (d) => String(d || '').slice(0, 10),
    getSharedState: async () => overrides.state || { dailyReports: [] },
  });
  const inDateRange = (d, s, e) => {
    const day = String(d || '').slice(0, 10);
    if (s && day < s) return false;
    if (e && day > e) return false;
    return true;
  };
  const stateFindUserRecord = (_s, u) => ({
    username: u,
    store: overrides.myStore || '我的店',
  });
  return {
    pool,
    queries,
    inDateRange,
    stateFindUserRecord,
    getSharedState: async () => overrides.state || { dailyReports: [] },
  };
}

test('queryPrivateRoomMonthTotal returns 0 when store or month empty', async () => {
  const queries = [];
  const pool = {
    query: async (...a) => {
      queries.push(a);
      return { rows: [{ total: 99 }] };
    },
  };
  const expandAgentStoreLabels = (s) => [s];

  assert.deepEqual(
    await queryPrivateRoomMonthTotal({ pool, store: '', month: '2026-07', tenantId: 'default', expandAgentStoreLabels }),
    { total: 0 }
  );
  assert.deepEqual(
    await queryPrivateRoomMonthTotal({ pool, store: '测试店', month: '', tenantId: 'default', expandAgentStoreLabels }),
    { total: 0 }
  );
  assert.equal(queries.length, 0);
});

test('queryPrivateRoomMonthTotal exact match then ILIKE fallback', async () => {
  const calls = [];
  const pool = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (calls.length === 1) return { rows: [{ total: 0 }] };
      return { rows: [{ total: 12 }] };
    },
  };
  const expandAgentStoreLabels = (s) => [s, `${s}别名`];

  const out = await queryPrivateRoomMonthTotal({
    pool,
    store: '洪潮店',
    month: '2026-07',
    tenantId: 'default',
    expandAgentStoreLabels,
  });

  assert.equal(out.total, 12);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /TRIM\(store\) = ANY/i);
  assert.match(calls[1].sql, /ILIKE ANY/i);
  assert.deepEqual(calls[0].args, ['2026-07', ['洪潮店', '洪潮店别名'], 'default']);
});

test('deleteDailyReportFromState filters list and calls merge', async () => {
  const merges = [];
  const state = {
    dailyReports: [
      { store: 'A店', date: '2026-07-01', id: 'keep1' },
      { store: 'B店', date: '2026-07-01', id: 'remove' },
      { store: 'A店', date: '2026-07-02', id: 'keep2' },
    ],
  };

  const result = await deleteDailyReportFromState({
    store: 'B店',
    date: '2026-07-01',
    getSharedState: async () => state,
    mergeSharedStateFields: async (patch, keys) => {
      merges.push({ patch, keys });
    },
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(merges.length, 1);
  assert.equal(merges[0].patch.dailyReports.length, 2);
  assert.ok(merges[0].patch.dailyReports.every((r) => !(r.store === 'B店' && r.date === '2026-07-01')));
  assert.deepEqual(merges[0].keys, { dailyReports: ['store', 'date'] });
});

test('deleteDailyReportFromState returns state_merge_failed on merge error', async () => {
  const result = await deleteDailyReportFromState({
    store: 'A店',
    date: '2026-07-01',
    getSharedState: async () => ({ dailyReports: [] }),
    mergeSharedStateFields: async () => {
      throw new Error('merge boom');
    },
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  assert.equal(result.error, 'state_merge_failed');
  assert.equal(result.message, 'merge boom');
});

test('syncSubmittedDailyReportsToPg only upserts submitted matching date', async () => {
  const upserts = [];
  const state = {
    dailyReports: [
      { store: 'A店', date: '2026-07-01', submitted: true, data: {} },
      { store: 'B店', date: '2026-07-01', submittedAt: '2026-07-01T10:00:00+08:00', data: {} },
      { store: 'A店', date: '2026-07-02', submitted: true, data: {} },
      { store: 'C店', date: '2026-07-01', data: {} },
    ],
  };

  const out = await syncSubmittedDailyReportsToPg({
    date: '2026-07-01',
    storeFilter: 'A店',
    tenantId: 'default',
    getSharedState: async () => state,
    safeDateOnly: (d) => String(d || '').slice(0, 10),
    upsertDailyReportPgFromStateReport: async (dr, tenantId) => {
      upserts.push({ dr, tenantId });
    },
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  assert.equal(out.ok, true);
  assert.equal(out.date, '2026-07-01');
  assert.equal(out.storeFilter, 'A店');
  assert.equal(out.matched, 1);
  assert.equal(out.results.length, 1);
  assert.deepEqual(out.results[0], { store: 'A店', date: '2026-07-01', ok: true });
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].dr.store, 'A店');
  assert.equal(upserts[0].tenantId, 'default');
});

test('syncSubmittedDailyReportsToPg records upsert failures', async () => {
  const out = await syncSubmittedDailyReportsToPg({
    date: '2026-07-01',
    storeFilter: '',
    tenantId: 'default',
    getSharedState: async () => ({
      dailyReports: [{ store: 'X店', date: '2026-07-01', submitted: true }],
    }),
    safeDateOnly: (d) => String(d || '').slice(0, 10),
    upsertDailyReportPgFromStateReport: async () => {
      throw new Error('pg fail');
    },
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
  });

  assert.equal(out.matched, 1);
  assert.deepEqual(out.results[0], { store: 'X店', date: '2026-07-01', ok: false, error: 'pg fail' });
});

test('listDailyReports filters by store for restricted store_manager role', async () => {
  const { pool, queries, inDateRange, stateFindUserRecord, getSharedState } = makeListDeps({
    myStore: '我的店',
    state: {
      dailyReports: [
        { store: '我的店', date: '2026-07-01', data: {} },
        { store: '其他店', date: '2026-07-01', data: {} },
      ],
    },
  });

  const out = await listDailyReports({
    pool,
    getSharedState,
    stateFindUserRecord,
    inDateRange,
    username: 'mgr1',
    role: 'store_manager',
    date: '',
    start: '',
    end: '',
    storeQ: '',
    limit: 200,
    allowedStores: ['我的店'],
    currentStore: '我的店',
    tenantId: 'default',
  });

  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].store, '我的店');
  assert.ok(queries.some((q) => /ORDER BY date DESC/i.test(String(q[0]))));
});

test('listDailyReports merges PG row when state empty for date', async () => {
  const pgRow = {
    store: 'A店',
    date: '2026-07-15',
    brand: '洪潮',
    actual_revenue: 10000,
    pre_discount_revenue: 11000,
    total_discount: 1000,
    dine_orders: 50,
    dine_revenue: 8000,
    dine_traffic: 60,
    efficiency: 1.2,
    labor_total: 3000,
    actual_margin: 4000,
    gross_profit: 4000,
    dianping_rating: 4.5,
    new_wechat_members: 3,
    wechat_month_total: 20,
    private_room_uses: 0,
    operational_anomaly_note: '',
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
  };

  const { pool, inDateRange, stateFindUserRecord, getSharedState } = makeListDeps({
    state: { dailyReports: [] },
    poolQuery: async (sql) => {
      if (/date >= \$1::date AND date <= \$2::date/i.test(String(sql))) {
        return { rows: [pgRow] };
      }
      if (/unnest/i.test(String(sql))) {
        return { rows: [{ store: 'A店', date: '2026-07-15', dianping_rating: 4.5, new_wechat_members: 3, wechat_month_total: 20, operational_anomaly_note: '' }] };
      }
      return { rows: [] };
    },
  });

  const out = await listDailyReports({
    pool,
    getSharedState,
    stateFindUserRecord,
    inDateRange,
    username: 'admin1',
    role: 'admin',
    date: '2026-07-15',
    start: '',
    end: '',
    storeQ: 'A店',
    limit: 200,
    allowedStores: [],
    currentStore: '',
    tenantId: 'default',
  });

  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].store, 'A店');
  assert.equal(out.items[0].date, '2026-07-15');
  assert.equal(out.wechat_month_base, 0);
});

test('listDailyReports filters null entries from dailyReports without throwing', async () => {
  const { pool, inDateRange, stateFindUserRecord, getSharedState } = makeListDeps({
    state: {
      dailyReports: [
        null,
        { store: 'B店', date: '2026-07-02', data: {} },
        'bad',
      ],
    },
  });

  const out = await listDailyReports({
    pool,
    getSharedState,
    stateFindUserRecord,
    inDateRange,
    username: 'admin1',
    role: 'admin',
    date: '',
    start: '',
    end: '',
    storeQ: 'B店',
    limit: 200,
    allowedStores: [],
    currentStore: '',
    tenantId: 'default',
  });

  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].store, 'B店');
});

function makeUpsertDeps(overrides = {}) {
  const queries = [];
  const merges = [];
  const adminNotifies = [];
  const pool = {
    query: async (...a) => {
      queries.push(a);
      if (overrides.poolQuery) return overrides.poolQuery(...a);
      return { rows: [] };
    },
  };
  const stateFindUserRecord = (_s, u) => ({
    username: u,
    store: overrides.myStore !== undefined ? overrides.myStore : '我的店',
  });
  const deps = {
    pool,
    queries,
    merges,
    adminNotifies,
    getSharedState: async () => overrides.state || { dailyReports: [] },
    mergeSharedStateFields: async (patch, keys) => {
      merges.push({ patch, keys });
      if (overrides.mergeThrows) throw new Error('merge boom');
    },
    stateFindUserRecord,
    addStateNotification: (s, n) => ({
      ...s,
      notifications: [...(Array.isArray(s.notifications) ? s.notifications : []), n],
    }),
    makeNotif: (u, title, msg, meta) => ({ id: 'n1', user: u, title, message: msg, ...meta }),
    notifyAdminsDualWriteFailure: (...a) => {
      adminNotifies.push(a);
    },
    safeErrMessage: (e) => String(e?.message || e),
    hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    randomUUID: () => 'uuid-test-1',
    recalcWechatMonthTotalsForStoreMonth: async () => {},
    reconcileDailyReportAttendanceRegister: async () => {},
  };
  const callUpsert = (extra = {}) =>
    upsertDailyReport({
      ...deps,
      username: extra.username ?? 'user1',
      role: extra.role ?? 'admin',
      date: extra.date ?? '2026-07-24',
      bodyStore: extra.bodyStore ?? '我的店',
      allowedStores: extra.allowedStores ?? ['我的店'],
      currentStore: extra.currentStore ?? '我的店',
      dataPayload: extra.dataPayload ?? { gross: 100 },
      wantSubmit: extra.wantSubmit ?? false,
      tenantId: extra.tenantId ?? 'default',
    });
  return { ...deps, callUpsert };
}

function isDailyReportsInsertQuery(sql) {
  return /INSERT INTO daily_reports/i.test(String(sql || ''));
}

test('upsertDailyReport returns locked for store_manager editing submitted report', async () => {
  const { callUpsert, merges } = makeUpsertDeps({
    state: {
      dailyReports: [
        {
          store: '我的店',
          date: '2026-07-24',
          submittedAt: '2026-07-24T10:00:00+08:00',
          data: { gross: 50 },
        },
      ],
    },
  });

  const result = await callUpsert({ role: 'store_manager', wantSubmit: true });

  assert.deepEqual(result, { error: 'locked', status: 403 });
  assert.equal(merges.length, 0);
});

test('upsertDailyReport returns missing_store for front_manager without store', async () => {
  const { callUpsert, merges } = makeUpsertDeps({ myStore: '' });

  const result = await callUpsert({
    role: 'front_manager',
    bodyStore: '',
    currentStore: '',
    allowedStores: [],
  });

  assert.deepEqual(result, { error: 'missing_store', status: 400 });
  assert.equal(merges.length, 0);
});

test('upsertDailyReport draft save skips PG insert and merge succeeds without submittedAt', async () => {
  const { callUpsert, queries, merges } = makeUpsertDeps({ state: { dailyReports: [] } });

  const result = await callUpsert({ wantSubmit: false, dataPayload: { gross: 200 } });

  assert.equal(result.ok, true);
  assert.ok(result.item);
  assert.equal(result.item.submittedAt, undefined);
  assert.equal(queries.filter((q) => isDailyReportsInsertQuery(q[0])).length, 0);
  assert.equal(merges.length, 1);
  assert.equal(merges[0].patch.dailyReports.length, 1);
  assert.equal(merges[0].patch.dailyReports[0].store, '我的店');
});

test('upsertDailyReport submit success writes PG and sets submittedAt', async () => {
  const { callUpsert, queries, merges } = makeUpsertDeps({ state: { dailyReports: [] } });

  const result = await callUpsert({ wantSubmit: true, dataPayload: { gross: 300, brand: '洪潮' } });

  assert.equal(result.ok, true);
  assert.equal(result.item.submittedAt, '2026-07-24T12:00:00+08:00');
  assert.equal(result.item.submittedBy, 'user1');
  assert.equal(queries.filter((q) => isDailyReportsInsertQuery(q[0])).length, 1);
  assert.equal(merges.length, 1);
});

test('upsertDailyReport pg_sync_failed skips merge and notifies admins', async () => {
  const { callUpsert, queries, merges, adminNotifies } = makeUpsertDeps({
    state: { dailyReports: [] },
    poolQuery: async (sql) => {
      if (isDailyReportsInsertQuery(sql)) throw new Error('pg boom');
      return { rows: [] };
    },
  });

  const result = await callUpsert({ wantSubmit: true });

  assert.equal(result.error, 'pg_sync_failed');
  assert.equal(result.status, 502);
  assert.equal(result.message, 'pg boom');
  assert.match(result.hint, /PostgreSQL 表 daily_reports 双写失败/);
  assert.equal(merges.length, 0);
  assert.equal(queries.filter((q) => isDailyReportsInsertQuery(q[0])).length, 1);
  assert.equal(adminNotifies.length, 1);
  assert.match(String(adminNotifies[0][0]), /新建 我的店 2026-07-24/);
});
