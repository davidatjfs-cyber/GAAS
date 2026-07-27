import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listHistory,
  listDishAliases,
  createCoreProduct,
  clearHistory,
  deleteDishAlias,
  getCoreProductSales,
  predictForecast,
  estimateRevenue,
} from '../service.js';
import {
  loadGrossProfitHistory,
  mergeDishLibraryCosts,
} from '../gross-profit-helpers.js';

function baseCtx(overrides = {}) {
  return {
    pool: {
      query: async () => ({ rows: [], rowCount: 0 }),
    },
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    pickMyStoreFromState: () => '',
    isForecastStoreScopedRole: () => false,
    canAccessAnalyticsReports: (role) => role === 'admin' || role === 'store_manager',
    canManageGrossProfitProfiles: (role) => role === 'admin',
    normalizeForecastBizType: (v) => String(v || '').trim(),
    normalizeForecastSlot: (v) => String(v || '').trim(),
    normalizeDishAliasBizType: (v) => String(v || '').trim() || '*',
    normalizeForecastWeather: (v) => String(v || '').trim(),
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    },
    safeNumber: (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    },
    shiftForecastDate: (d, _days) => d,
    loadInventoryForecastHistoryFromSalesRaw: async () => [],
    resolveTenantIdDefault: () => 'default',
    hrmsNowISO: () => '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}

test('listHistory: missing_user / forbidden', async () => {
  const missing = await listHistory(baseCtx(), { username: '', role: 'admin', query: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);
  assert.equal(missing.error, 'missing_user');

  const forbidden = await listHistory(baseCtx(), { username: 'bob', role: 'employee', query: {} });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.error, 'forbidden');
});

test('listHistory: empty history structure', async () => {
  const result = await listHistory(baseCtx(), {
    username: 'admin',
    role: 'admin',
    query: { store: '马己仙路店' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.store, '马己仙路店');
  assert.deepEqual(result.items, []);
  assert.equal(result.storageSource, 'inventoryForecastHistory');
});

test('listDishAliases: empty list for admin', async () => {
  const result = await listDishAliases(baseCtx(), {
    username: 'admin',
    role: 'admin',
    query: {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
});

test('createCoreProduct: missing_product / invalid_target_qty', async () => {
  const missing = await createCoreProduct(baseCtx(), {
    username: 'admin',
    role: 'admin',
    body: { store: '洪潮店', targetQty: 10 },
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);
  assert.equal(missing.error, 'missing_product');

  const badQty = await createCoreProduct(baseCtx(), {
    username: 'admin',
    role: 'admin',
    body: { store: '洪潮店', product: '招牌牛腩', targetQty: 0 },
  });
  assert.equal(badQty.ok, false);
  assert.equal(badQty.error, 'invalid_target_qty');
});

test('clearHistory: admin_only / ok clears all', async () => {
  const forbidden = await clearHistory(baseCtx(), { role: 'employee', query: {} });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.error, 'admin_only');

  let saved = null;
  const result = await clearHistory(
    baseCtx({
      getSharedState: async () => ({
        inventoryForecastHistory: [{ store: 'A' }, { store: 'B' }],
        inventoryForecastPredictions: [{ store: 'A' }],
        inventoryForecastEvaluations: [{ store: 'B' }],
      }),
      saveSharedState: async (s) => { saved = s; },
    }),
    { role: 'admin', query: {}, body: {} }
  );
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 2);
  assert.equal(result.remaining, 0);
  assert.equal(result.store, '(all)');
  assert.deepEqual(saved.inventoryForecastHistory, []);
  assert.deepEqual(saved.inventoryForecastPredictions, []);
  assert.deepEqual(saved.inventoryForecastEvaluations, []);
});

test('deleteDishAlias: invalid_id / not_found', async () => {
  const badId = await deleteDishAlias(baseCtx(), {
    username: 'admin',
    role: 'admin',
    params: { id: 'x' },
  });
  assert.equal(badId.ok, false);
  assert.equal(badId.error, 'invalid_id');

  const notFound = await deleteDishAlias(
    baseCtx({
      pool: { query: async () => ({ rows: [] }) },
    }),
    { username: 'admin', role: 'admin', params: { id: '99' } }
  );
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.error, 'not_found');
});

test('getCoreProductSales: missing_date_range', async () => {
  const result = await getCoreProductSales(baseCtx(), {
    username: 'admin',
    role: 'admin',
    query: { store: '洪潮店' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(result.error, 'missing_date_range');
});

test('predictForecast: missing_date (no LLM); estimateRevenue: missing_date', async () => {
  const predict = await predictForecast(
    baseCtx({
      buildForecastByAI: async () => {
        throw new Error('LLM should not be called');
      },
    }),
    {
      username: 'admin',
      role: 'admin',
      body: {
        store: '洪潮店',
        bizType: 'dine_in',
        slot: 'dinner',
        expectedRevenue: 1000,
        // date missing
      },
    }
  );
  assert.equal(predict.ok, false);
  assert.equal(predict.error, 'missing_date');

  const revenue = await estimateRevenue(baseCtx(), {
    username: 'admin',
    role: 'admin',
    body: { store: '洪潮店' },
  });
  assert.equal(revenue.ok, false);
  assert.equal(revenue.error, 'missing_date');
});

test('predictForecast: happy path orchestrates helpers and persists state', async () => {
  let saved = null;
  const result = await predictForecast(
    baseCtx({
      getSharedState: async () => ({
        forecastCoreProducts: [{ store: '洪潮店', product: '招牌牛腩', targetQty: 10 }],
        inventoryForecastPredictions: [],
        inventoryForecastEvaluations: [],
      }),
      saveSharedState: async (s) => { saved = s; },
      buildForecastProductAliasLookup: () => new Map(),
      canonicalizeForecastRows: (rows) => rows,
      computeSlotRevenueShare: () => ({ slotShare: 0.5, splitMode: 'history' }),
      buildForecastCalibrationFactors: () => ({ globalFactor: 1, sampleCount: 0 }),
      buildForecastByHeuristic: () => ({
        predictions: [{ product: '招牌牛腩', qty: 8 }],
        confidence: 0.75,
        summary: '启发式',
      }),
      buildForecastByAI: async () => null,
      applyForecastCalibration: (preds) => preds,
      constrainPredictionsToHistory: (preds) => preds,
      isExcludedForecastProduct: () => false,
      resolveForecastProductName: (name) => ({ display: name, key: name }),
      calcForecastAccuracyMetrics: () => ({
        totalPredQty: 8,
        totalActualQty: 7,
        totalAbsError: 1,
        totalAccuracy: 0.875,
        mape: 0.125,
        hitRate20: 1,
        productCount: 1,
        perProduct: [],
        topDiffProducts: [],
      }),
      loadInventoryForecastHistoryFromSalesRaw: async ({ slot }) => (
        slot
          ? [{ date: '2026-07-24', productQuantities: { 招牌牛腩: 7 } }]
          : [{ date: '2026-07-24' }]
      ),
    }),
    {
      username: 'admin',
      role: 'admin',
      body: {
        store: '洪潮店',
        bizType: 'dine_in',
        slot: 'dinner',
        date: '2026-07-24',
        expectedRevenue: 2000,
        topN: 10,
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.store, '洪潮店');
  assert.equal(result.source, 'heuristic');
  assert.equal(result.historyCount, 1);
  assert.ok(Array.isArray(result.predictions));
  assert.ok(saved?.inventoryForecastPredictions?.length >= 1);
});

test('mergeDishLibraryCosts: deduplicates configured products and adds valid Feishu costs', async () => {
  const logs = [];
  const ctx = baseCtx({
    normalizeStoreKey: (value) => String(value).toLowerCase(),
    forecastBrandToken: () => 'm',
    normalizeProductName: (value) => String(value).trim().toLowerCase(),
    pool: {
      query: async (sql, params) => {
        assert.match(sql, /dish_library_costs/);
        assert.deepEqual(params, [['a'], 'm']);
        return {
          rows: [
            { biz_type: 'dine_in', dish_name: '已配置', unit_cost: '5' },
            { biz_type: 'dine_in', dish_name: '新增菜品', unit_cost: '8.125' },
            { biz_type: 'dine_in', dish_name: '无效成本', unit_cost: '-1' },
            { biz_type: 'dine_in', dish_name: '', unit_cost: '2' },
          ],
        };
      },
    },
  });
  const profiles = [{ product: '已配置', bizType: 'dine_in', costPerUnit: 4 }];

  const result = await mergeDishLibraryCosts(ctx, profiles, {
    brandName: '马己仙',
    storeScope: ['A'],
  }, {
    includeSource: true,
    log: { error: (entry) => logs.push(entry) },
  });

  assert.equal(result.length, 2);
  assert.deepEqual(result[1], {
    product: '新增菜品',
    bizType: 'dine_in',
    costPerUnit: 8.125,
    source: 'feishu_bitable',
  });
  assert.deepEqual(logs, []);
});

test('mergeDishLibraryCosts: returns profiles when cost lookup fails', async () => {
  const logs = [];
  const profiles = [{ product: '原菜品' }];
  const result = await mergeDishLibraryCosts(baseCtx({
    normalizeStoreKey: (value) => value,
    forecastBrandToken: () => '',
    normalizeProductName: (value) => value,
    pool: { query: async () => { throw new Error('db unavailable'); } },
  }), profiles, {
    brandName: '',
    storeScope: ['A'],
  }, {
    log: { error: (entry) => logs.push(entry) },
  });

  assert.equal(result, profiles);
  assert.equal(logs[0].msg, 'inventory_gross_profit_dish_costs_merge_failed');
});

test('loadGrossProfitHistory: loads POS rows and filters matching state history', async () => {
  const state = {
    inventoryForecastHistory: [
      { store: 'A', bizType: 'dine_in', date: '2026-07-01' },
      { store: 'A', bizType: 'delivery', date: '2026-07-01' },
      { store: 'B', bizType: 'dine_in', date: '2026-07-01' },
      { store: 'A', bizType: 'dine_in', date: '2026-06-01' },
    ],
  };
  let mergeArgs;
  const ctx = baseCtx({
    loadInventoryForecastHistoryFromSalesRaw: async (input) => {
      assert.deepEqual(input, {
        storeScope: ['A'],
        bizType: 'dine_in',
        startDate: '2026-07-01',
        endDate: '2026-07-31',
      });
      return [{ store: 'A', date: '2026-07-02' }];
    },
    inDateRange: (date, start, end) => date >= start && date <= end,
    mergePreferredForecastHistoryRows: (...args) => {
      mergeArgs = args;
      return [{ merged: true }];
    },
  });

  const result = await loadGrossProfitHistory(ctx, state, { storeScope: ['A'] }, {
    bizType: 'dine_in',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  });

  assert.deepEqual(result, [{ merged: true }]);
  assert.equal(mergeArgs[0].length, 1);
  assert.deepEqual(mergeArgs[1], [{ store: 'A', bizType: 'dine_in', date: '2026-07-01' }]);
  assert.equal(mergeArgs[2], 5000);
});
