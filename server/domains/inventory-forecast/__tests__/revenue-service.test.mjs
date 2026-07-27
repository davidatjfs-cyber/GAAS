import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRevenue, getAccuracy } from '../revenue-service.js';

function baseCtx(overrides = {}) {
  return {
    pool: { query: async () => ({ rows: [] }) },
    getSharedState: async () => ({}),
    pickMyStoreFromState: () => '',
    isForecastStoreScopedRole: () => false,
    canAccessAnalyticsReports: (role) => role === 'admin' || role === 'store_manager',
    normalizeForecastBizType: (v) => String(v || '').trim(),
    normalizeForecastSlot: (v) => String(v || '').trim(),
    normalizeForecastWeather: (v) => String(v || '').trim(),
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    },
    resolvePosStoreKeys: async (stores) => stores.map((s) => String(s).toLowerCase()),
    isCNYPeriod: () => false,
    isKnownPublicHoliday: () => false,
    inDateRange: (date, start, end) => (!start || date >= start) && (!end || date <= end),
    estimateRevenueByHistory: (rows) => ({ estimatedRevenue: rows.length * 100 }),
    summarizeForecastAccuracyRows: (items) => ({ comparedCount: items.length }),
    ...overrides,
  };
}

test('estimateRevenue: missing_user / forbidden / missing_date / missing_store', async () => {
  const missing = await estimateRevenue(baseCtx(), { username: '', role: 'admin', body: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await estimateRevenue(baseCtx(), { username: 'bob', role: 'employee', body: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const missingDate = await estimateRevenue(baseCtx(), { username: 'admin', role: 'admin', body: {} });
  assert.deepEqual(missingDate, { ok: false, status: 400, error: 'missing_date' });

  const missingStore = await estimateRevenue(baseCtx(), {
    username: 'admin', role: 'admin', body: { date: '2026-07-10' },
  });
  assert.deepEqual(missingStore, { ok: false, status: 400, error: 'missing_store' });
});

test('estimateRevenue: filters history up to target date and delegates estimate', async () => {
  const result = await estimateRevenue(baseCtx({
    getSharedState: async () => ({
      inventoryForecastHistory: [
        { store: '洪潮店', date: '2026-07-01' },
        { store: '洪潮店', date: '2026-07-20' },
        { store: '别的店', date: '2026-07-01' },
      ],
    }),
  }), {
    username: 'admin', role: 'admin',
    body: { store: '洪潮店', date: '2026-07-10', weather: 'sunny' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.store, '洪潮店');
  assert.equal(result.target.date, '2026-07-10');
  assert.equal(result.target.weather, 'sunny');
  assert.deepEqual(result.estimate, { estimatedRevenue: 100 });
});

test('estimateRevenue: reports server_error on failure', async () => {
  const result = await estimateRevenue(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', body: { store: 'A', date: '2026-07-10' } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('getAccuracy: missing_user / forbidden / missing_store', async () => {
  const missing = await getAccuracy(baseCtx(), { username: '', role: 'admin', query: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await getAccuracy(baseCtx(), { username: 'bob', role: 'employee', query: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const missingStore = await getAccuracy(baseCtx(), { username: 'admin', role: 'admin', query: {} });
  assert.deepEqual(missingStore, { ok: false, status: 400, error: 'missing_store' });
});

test('getAccuracy: filters by store/bizType/slot/date range and sorts newest first', async () => {
  const result = await getAccuracy(baseCtx({
    getSharedState: async () => ({
      inventoryForecastEvaluations: [
        { store: '洪潮店', bizType: 'dine_in', slot: 'lunch', date: '2026-07-01' },
        { store: '洪潮店', bizType: 'dine_in', slot: 'lunch', date: '2026-07-05' },
        { store: '洪潮店', bizType: 'delivery', slot: 'lunch', date: '2026-07-03' },
        { store: '别的店', bizType: 'dine_in', slot: 'lunch', date: '2026-07-04' },
      ],
    }),
  }), {
    username: 'admin', role: 'admin',
    query: { store: '洪潮店', bizType: 'dine_in', slot: 'lunch' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].date, '2026-07-05');
  assert.deepEqual(result.summary, { comparedCount: 2 });
});

test('getAccuracy: reports server_error on failure', async () => {
  const result = await getAccuracy(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', query: { store: 'A' } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});
