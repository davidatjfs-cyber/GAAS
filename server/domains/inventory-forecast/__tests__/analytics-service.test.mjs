import test from 'node:test';
import assert from 'node:assert/strict';
import { getCoreProductSales, getAnalytics } from '../analytics-service.js';

function baseCtx(overrides = {}) {
  return {
    getSharedState: async () => ({}),
    pickMyStoreFromState: () => '',
    isForecastStoreScopedRole: () => false,
    canAccessAnalyticsReports: (role) => role === 'admin' || role === 'store_manager',
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    },
    normalizeForecastBizType: (v) => String(v || '').trim(),
    inDateRange: (date, start, end) => (!start || date >= start) && (!end || date <= end),
    buildForecastProductAliasLookup: () => new Map(),
    resolveForecastProductName: (name) => ({ display: name, key: String(name || '').trim().toLowerCase() }),
    isExcludedForecastProduct: () => false,
    normalizeProductName: (v) => String(v || '').trim().toLowerCase(),
    loadInventoryForecastHistoryFromSalesRaw: async () => [],
    ...overrides,
  };
}

test('getCoreProductSales: missing_user / forbidden / missing_date_range / missing_store', async () => {
  const missing = await getCoreProductSales(baseCtx(), { username: '', role: 'admin', query: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await getCoreProductSales(baseCtx(), { username: 'bob', role: 'employee', query: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const missingRange = await getCoreProductSales(baseCtx(), { username: 'admin', role: 'admin', query: {} });
  assert.deepEqual(missingRange, { ok: false, status: 400, error: 'missing_date_range' });

  const missingStore = await getCoreProductSales(baseCtx(), {
    username: 'admin', role: 'admin', query: { startDate: '2026-07-01', endDate: '2026-07-31' },
  });
  assert.deepEqual(missingStore, { ok: false, status: 400, error: 'missing_store' });
});

test('getCoreProductSales: returns empty items when no core products configured', async () => {
  const result = await getCoreProductSales(baseCtx(), {
    username: 'admin', role: 'admin',
    query: { store: '洪潮店', startDate: '2026-07-01', endDate: '2026-07-31' },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
  assert.equal(result.message, '暂无核心产品配置');
});

test('getCoreProductSales: computes achievement rate against history sales', async () => {
  const result = await getCoreProductSales(baseCtx({
    getSharedState: async () => ({
      forecastCoreProducts: [{ id: 'p1', store: '洪潮店', product: '招牌牛腩', targetQty: 5 }],
      inventoryForecastHistory: [
        { store: '洪潮店', date: '2026-07-01', productQuantities: { 招牌牛腩: 3 } },
        { store: '洪潮店', date: '2026-07-02', productQuantities: { 招牌牛腩: 4 } },
        { store: '别的店', date: '2026-07-01', productQuantities: { 招牌牛腩: 100 } },
      ],
    }),
  }), {
    username: 'admin', role: 'admin',
    query: { store: '洪潮店', startDate: '2026-07-01', endDate: '2026-07-31' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dayCount, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].actualQty, 7);
  assert.equal(result.items[0].totalTarget, 10);
  assert.equal(result.items[0].achievementRate, 0.7);
});

test('getCoreProductSales: reports server_error on failure', async () => {
  const result = await getCoreProductSales(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', query: { store: 'A', startDate: '2026-07-01', endDate: '2026-07-31' } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('getAnalytics: missing_user / forbidden / missing_store', async () => {
  const missing = await getAnalytics(baseCtx(), { username: '', role: 'admin', query: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await getAnalytics(baseCtx(), { username: 'bob', role: 'employee', query: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const missingStore = await getAnalytics(baseCtx(), { username: 'admin', role: 'admin', query: {} });
  assert.deepEqual(missingStore, { ok: false, status: 400, error: 'missing_store' });
});

test('getAnalytics: builds top/bottom product stats and core target completion', async () => {
  const result = await getAnalytics(baseCtx({
    loadInventoryForecastHistoryFromSalesRaw: async () => [
      { store: '洪潮店', bizType: 'dine_in', date: '2026-07-01', expectedRevenue: 100, productQuantities: { 牛腩: 8, 鱼片: 2 } },
      { store: '洪潮店', bizType: 'dine_in', date: '2026-07-02', expectedRevenue: 50, productQuantities: { 牛腩: 4 } },
    ],
    getSharedState: async () => ({
      forecastCoreProducts: [{ store: '洪潮店', product: '牛腩', targetQty: 10 }],
    }),
  }), {
    username: 'admin', role: 'admin',
    query: { store: '洪潮店', startDate: '2026-07-01', endDate: '2026-07-31' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.sampleCount, 2);
  assert.ok(result.top20ByQty.find((x) => x.product === '牛腩'));
  assert.equal(result.coreTargetStats[0].product, '牛腩');
  assert.equal(result.coreTargetStats[0].actualQty, 12);
  assert.equal(result.coreTargetStats[0].completionRate, 120);
});

test('getAnalytics: reports server_error on failure', async () => {
  const result = await getAnalytics(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', query: { store: 'A' } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});
