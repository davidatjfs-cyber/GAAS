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
