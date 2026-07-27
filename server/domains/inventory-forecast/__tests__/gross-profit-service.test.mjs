import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listGrossProfitProfiles,
  upsertGrossProfitProfiles,
  updateGrossProfitProfile,
  deleteGrossProfitProfile,
  estimateGrossMargin,
} from '../gross-profit-service.js';

function baseCtx(overrides = {}) {
  return {
    pool: { query: async () => ({ rows: [] }) },
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    canAccessAnalyticsReports: (role) => role === 'admin' || role === 'store_manager',
    canManageGrossProfitProfiles: (role) => role === 'admin',
    normalizeForecastBizType: (v) => String(v || '').trim(),
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    },
    safeNumber: (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    },
    shiftForecastDate: (d) => d,
    hrmsNowISO: () => '2026-07-27T00:00:00.000Z',
    normalizeBrandId: (v) => String(v || '').trim().toLowerCase(),
    resolveStoreBrandContext: (_state, store) => ({
      brandId: store === '洪潮店' ? 'brand-a' : 'brand-b',
      brandName: '测试品牌',
    }),
    resolveForecastScope: (_state, _username, _role, store) => ({
      store: String(store || '').trim(),
      brandId: store ? 'brand-a' : '',
      brandName: '测试品牌',
      storeScope: store ? [store] : [],
    }),
    buildForecastProductAliasLookup: () => new Map(),
    resolveForecastProductName: (name) => ({ display: name, key: String(name || '').trim().toLowerCase() }),
    computeAvgPricePerProduct: () => new Map(),
    normalizeGrossProfitProfileItem: (it) => (it?.product ? { product: String(it.product).trim(), costPerUnit: it.costPerUnit, grossPerUnit: it.grossPerUnit, bizType: it.bizType || '' } : null),
    getStoreNamesByBrand: () => [],
    loadInventoryForecastHistoryFromSalesRaw: async () => [],
    mergePreferredForecastHistoryRows: (salesRows) => salesRows,
    inDateRange: (date, start, end) => (!start || date >= start) && (!end || date <= end),
    estimateGrossMarginByHistory: () => ({ marginRate: 0.5 }),
    randomUUID: () => 'uuid-test-1',
    ...overrides,
  };
}

test('listGrossProfitProfiles: missing_user / forbidden / missing_brand_or_store_scope', async () => {
  const missing = await listGrossProfitProfiles(baseCtx(), { username: '', role: 'admin', query: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await listGrossProfitProfiles(baseCtx(), { username: 'bob', role: 'employee', query: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const missingScope = await listGrossProfitProfiles(baseCtx(), { username: 'admin', role: 'admin', query: {} });
  assert.deepEqual(missingScope, { ok: false, status: 400, error: 'missing_brand_or_store_scope' });
});

test('listGrossProfitProfiles: filters by brand, merges dish-library costs, sorts by name', async () => {
  const result = await listGrossProfitProfiles(baseCtx({
    getSharedState: async () => ({
      forecastGrossProfitProfiles: [
        { id: '1', brandId: 'brand-a', product: '牛腩', costPerUnit: 10 },
        { id: '2', brandId: 'brand-b', product: '鲈鱼', costPerUnit: 20 },
      ],
    }),
  }), {
    username: 'admin', role: 'admin', query: { store: '洪潮店' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.brandId, 'brand-a');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product, '牛腩');
});

test('listGrossProfitProfiles: reports server_error on failure', async () => {
  const result = await listGrossProfitProfiles(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', query: { store: '洪潮店' } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('upsertGrossProfitProfiles: missing_user / forbidden / missing_items / missing_brand_or_store_scope', async () => {
  const missing = await upsertGrossProfitProfiles(baseCtx(), { username: '', role: 'admin', body: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await upsertGrossProfitProfiles(baseCtx(), { username: 'bob', role: 'employee', body: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden', message: '仅管理员可配置产品毛利' });

  const missingItems = await upsertGrossProfitProfiles(baseCtx(), { username: 'admin', role: 'admin', body: {} });
  assert.deepEqual(missingItems, { ok: false, status: 400, error: 'missing_items' });

  const missingScope = await upsertGrossProfitProfiles(baseCtx(), {
    username: 'admin', role: 'admin', body: { product: '牛腩', costPerUnit: 10 },
  });
  assert.deepEqual(missingScope, { ok: false, status: 400, error: 'missing_brand_or_store_scope' });
});

test('upsertGrossProfitProfiles: creates new product with generated id', async () => {
  let saved;
  const result = await upsertGrossProfitProfiles(baseCtx({
    getSharedState: async () => ({ forecastGrossProfitProfiles: [] }),
    saveSharedState: async (state) => { saved = state; },
  }), {
    username: 'admin', role: 'admin',
    body: { store: '洪潮店', product: '牛腩', costPerUnit: 10 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(saved.forecastGrossProfitProfiles[0].id, 'uuid-test-1');
  assert.equal(saved.forecastGrossProfitProfiles[0].product, '牛腩');
});

test('upsertGrossProfitProfiles: merges into existing brand profiles via keyOf', async () => {
  let saved;
  const result = await upsertGrossProfitProfiles(baseCtx({
    getSharedState: async () => ({
      forecastGrossProfitProfiles: [{ id: 'x', brandId: 'brand-a', product: 'existing', costPerUnit: 1 }],
    }),
    saveSharedState: async (state) => { saved = state; },
  }), {
    username: 'admin', role: 'admin',
    body: { store: '洪潮店', product: '牛腩', costPerUnit: 10 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(saved.forecastGrossProfitProfiles.length, 2);
  assert.ok(saved.forecastGrossProfitProfiles.some((x) => x.product === '牛腩'));
  assert.ok(saved.forecastGrossProfitProfiles.some((x) => x.id === 'x'));
});

test('updateGrossProfitProfile: missing_user / forbidden / missing_id / not_found', async () => {
  const missing = await updateGrossProfitProfile(baseCtx(), { username: '', role: 'admin', params: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await updateGrossProfitProfile(baseCtx(), { username: 'bob', role: 'employee', params: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden', message: '仅管理员可修改产品毛利' });

  const missingId = await updateGrossProfitProfile(baseCtx(), { username: 'admin', role: 'admin', params: {} });
  assert.deepEqual(missingId, { ok: false, status: 400, error: 'missing_id' });

  const notFound = await updateGrossProfitProfile(baseCtx(), {
    username: 'admin', role: 'admin', params: { id: 'missing' },
  });
  assert.deepEqual(notFound, { ok: false, status: 404, error: 'not_found' });
});

test('updateGrossProfitProfile: updates cost and rejects duplicate product name', async () => {
  let saved = null;
  const result = await updateGrossProfitProfile(baseCtx({
    getSharedState: async () => ({
      forecastGrossProfitProfiles: [
        { id: '1', store: '洪潮店', product: '牛腩', costPerUnit: 5, grossPerUnit: 3 },
      ],
    }),
    saveSharedState: async (s) => { saved = s; },
  }), {
    username: 'admin', role: 'admin',
    params: { id: '1' },
    body: { costPerUnit: 8 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.item.costPerUnit, 8);
  assert.equal(saved.forecastGrossProfitProfiles[0].costPerUnit, 8);

  const dup = await updateGrossProfitProfile(baseCtx({
    getSharedState: async () => ({
      forecastGrossProfitProfiles: [
        { id: '1', store: '洪潮店', product: '牛腩' },
        { id: '2', store: '洪潮店', product: '鱼片' },
      ],
    }),
  }), {
    username: 'admin', role: 'admin',
    params: { id: '2' },
    body: { product: '牛腩' },
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.error, 'duplicate_product');
});

test('updateGrossProfitProfile: reports server_error on failure', async () => {
  const result = await updateGrossProfitProfile(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', params: { id: '1' }, body: {} });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('deleteGrossProfitProfile: missing_user / forbidden / missing_id / not_found / ok', async () => {
  const missing = await deleteGrossProfitProfile(baseCtx(), { username: '', role: 'admin', params: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await deleteGrossProfitProfile(baseCtx(), { username: 'bob', role: 'employee', params: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden', message: '仅管理员可删除产品毛利' });

  const missingId = await deleteGrossProfitProfile(baseCtx(), { username: 'admin', role: 'admin', params: {} });
  assert.deepEqual(missingId, { ok: false, status: 400, error: 'missing_id' });

  const notFound = await deleteGrossProfitProfile(baseCtx({
    getSharedState: async () => ({ forecastGrossProfitProfiles: [] }),
  }), { username: 'admin', role: 'admin', params: { id: 'x' } });
  assert.deepEqual(notFound, { ok: false, status: 404, error: 'not_found' });

  let saved = null;
  const ok = await deleteGrossProfitProfile(baseCtx({
    getSharedState: async () => ({ forecastGrossProfitProfiles: [{ id: 'x' }, { id: 'y' }] }),
    saveSharedState: async (s) => { saved = s; },
  }), { username: 'admin', role: 'admin', params: { id: 'x' } });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(saved.forecastGrossProfitProfiles, [{ id: 'y' }]);
});

test('deleteGrossProfitProfile: reports server_error on failure', async () => {
  const result = await deleteGrossProfitProfile(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', params: { id: 'x' } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('estimateGrossMargin: missing_user / forbidden / missing_date_range / missing_brand_or_store_scope', async () => {
  const missing = await estimateGrossMargin(baseCtx(), { username: '', role: 'admin', body: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await estimateGrossMargin(baseCtx(), { username: 'bob', role: 'employee', body: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const missingRange = await estimateGrossMargin(baseCtx(), { username: 'admin', role: 'admin', body: {} });
  assert.deepEqual(missingRange, { ok: false, status: 400, error: 'missing_date_range' });

  const missingScope = await estimateGrossMargin(baseCtx(), {
    username: 'admin', role: 'admin', body: { startDate: '2026-07-01', endDate: '2026-07-31' },
  });
  assert.deepEqual(missingScope, { ok: false, status: 400, error: 'missing_brand_or_store_scope' });
});

test('estimateGrossMargin: delegates to ctx.estimateGrossMarginByHistory with merged profiles', async () => {
  const result = await estimateGrossMargin(baseCtx({
    getSharedState: async () => ({
      forecastGrossProfitProfiles: [{ id: '1', brandId: 'brand-a', product: '牛腩', costPerUnit: 5 }],
    }),
  }), {
    username: 'admin', role: 'admin',
    body: { store: '洪潮店', startDate: '2026-07-01', endDate: '2026-07-31' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.brandId, 'brand-a');
  assert.deepEqual(result.estimate, { marginRate: 0.5 });
});

test('estimateGrossMargin: reports server_error on failure', async () => {
  const result = await estimateGrossMargin(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', body: { store: '洪潮店', startDate: '2026-07-01', endDate: '2026-07-31' } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});
