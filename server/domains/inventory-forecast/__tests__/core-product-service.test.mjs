import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listCoreProducts,
  createCoreProduct,
  deleteCoreProduct,
} from '../core-product-service.js';

function baseCtx(overrides = {}) {
  return {
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    pickMyStoreFromState: () => '',
    isForecastStoreScopedRole: () => false,
    canAccessAnalyticsReports: (role) => role === 'admin' || role === 'store_manager',
    hrmsNowISO: () => '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

test('listCoreProducts validates access and applies the store scope', async () => {
  const missing = await listCoreProducts(baseCtx(), { username: '', role: 'admin', query: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await listCoreProducts(baseCtx(), { username: 'staff', role: 'employee', query: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const missingStore = await listCoreProducts(baseCtx(), { username: 'admin', role: 'admin', query: {} });
  assert.deepEqual(missingStore, { ok: false, status: 400, error: 'missing_store' });

  const result = await listCoreProducts(baseCtx({
    getSharedState: async () => ({
      forecastCoreProducts: [
        { id: 'a', store: 'A店', product: '牛肉' },
        { id: 'b', store: 'B店', product: '羊肉' },
      ],
    }),
    pickMyStoreFromState: () => 'A店',
    isForecastStoreScopedRole: (role) => role === 'store_manager',
  }), {
    username: 'manager',
    role: 'store_manager',
    query: { store: 'B店' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.store, 'A店');
  assert.deepEqual(result.items, [{ id: 'a', store: 'A店', product: '牛肉' }]);
});

test('listCoreProducts returns server_error when state loading fails', async () => {
  const result = await listCoreProducts(baseCtx({
    getSharedState: async () => { throw new Error('database unavailable'); },
  }), {
    username: 'admin',
    role: 'admin',
    query: { store: 'A店' },
  });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('createCoreProduct validates payload and scoped store', async () => {
  const missingUser = await createCoreProduct(baseCtx(), {
    username: '',
    role: 'admin',
    body: { store: 'A店', product: '牛肉', targetQty: 1 },
  });
  assert.equal(missingUser.error, 'missing_user');

  const forbidden = await createCoreProduct(baseCtx(), {
    username: 'staff',
    role: 'employee',
    body: { store: 'A店', product: '牛肉', targetQty: 1 },
  });
  assert.equal(forbidden.error, 'forbidden');

  const missingProduct = await createCoreProduct(baseCtx(), {
    username: 'admin',
    role: 'admin',
    body: { store: 'A店', targetQty: 1 },
  });
  assert.equal(missingProduct.error, 'missing_product');

  const invalidQty = await createCoreProduct(baseCtx(), {
    username: 'admin',
    role: 'admin',
    body: { store: 'A店', product: '牛肉', targetQty: 0 },
  });
  assert.equal(invalidQty.error, 'invalid_target_qty');

  const missingStore = await createCoreProduct(baseCtx(), {
    username: 'admin',
    role: 'admin',
    body: { product: '牛肉', targetQty: 1 },
  });
  assert.equal(missingStore.error, 'missing_store');
});

test('createCoreProduct creates then upserts the matching store/product', async () => {
  let saved;
  const existing = {
    id: 'kept-id',
    store: 'A店',
    product: '牛肉',
    targetQty: 3,
    createdAt: '2026-07-01T00:00:00.000Z',
    createdBy: 'original',
  };
  const result = await createCoreProduct(baseCtx({
    getSharedState: async () => ({
      untouched: true,
      forecastCoreProducts: [existing, { id: 'other', store: 'B店', product: '牛肉' }],
    }),
    saveSharedState: async (state) => { saved = state; },
  }), {
    username: 'admin',
    role: 'admin',
    body: { store: 'A店', product: '牛肉', targetQty: 8.66 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.item.id, 'kept-id');
  assert.equal(result.item.targetQty, 8.7);
  assert.equal(result.item.createdAt, existing.createdAt);
  assert.equal(result.item.createdBy, 'original');
  assert.equal(result.item.updatedBy, 'admin');
  assert.equal(saved.untouched, true);
  assert.deepEqual(saved.forecastCoreProducts[0], result.item);

  let scopedSaved;
  const scoped = await createCoreProduct(baseCtx({
    getSharedState: async () => ({}),
    saveSharedState: async (state) => { scopedSaved = state; },
    pickMyStoreFromState: () => 'A店',
    isForecastStoreScopedRole: (role) => role === 'store_manager',
  }), {
    username: 'manager',
    role: 'store_manager',
    body: { store: 'B店', product: '鸡肉', targetQty: 2 },
  });
  assert.equal(scoped.item.store, 'A店');
  assert.equal(scopedSaved.forecastCoreProducts.length, 1);
});

test('createCoreProduct reports server errors', async () => {
  const result = await createCoreProduct(baseCtx({
    getSharedState: async () => { throw new Error('database unavailable'); },
  }), {
    username: 'admin',
    role: 'admin',
    body: { store: 'A店', product: '牛肉', targetQty: 2 },
  });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('deleteCoreProduct validates, removes matching item, and reports failures', async () => {
  const missingUser = await deleteCoreProduct(baseCtx(), {
    username: '',
    role: 'admin',
    params: { id: 'a' },
  });
  assert.equal(missingUser.error, 'missing_user');

  const forbidden = await deleteCoreProduct(baseCtx(), {
    username: 'staff',
    role: 'employee',
    params: { id: 'a' },
  });
  assert.equal(forbidden.error, 'forbidden');

  const missingId = await deleteCoreProduct(baseCtx(), {
    username: 'admin',
    role: 'admin',
    params: {},
  });
  assert.equal(missingId.error, 'missing_id');

  const notFound = await deleteCoreProduct(baseCtx({
    getSharedState: async () => ({ forecastCoreProducts: [] }),
  }), {
    username: 'admin',
    role: 'admin',
    params: { id: 'missing' },
  });
  assert.deepEqual(notFound, { ok: false, status: 404, error: 'not_found' });

  let saved;
  const removed = await deleteCoreProduct(baseCtx({
    getSharedState: async () => ({
      forecastCoreProducts: [{ id: 'remove' }, { id: 'keep' }],
    }),
    saveSharedState: async (state) => { saved = state; },
  }), {
    username: 'admin',
    role: 'admin',
    params: { id: 'remove' },
  });
  assert.deepEqual(removed, { ok: true });
  assert.deepEqual(saved.forecastCoreProducts, [{ id: 'keep' }]);

  const failed = await deleteCoreProduct(baseCtx({
    getSharedState: async () => { throw new Error('database unavailable'); },
  }), {
    username: 'admin',
    role: 'admin',
    params: { id: 'remove' },
  });
  assert.deepEqual(failed, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});
