import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listHistory,
  clearHistory,
  batchHistory,
  uploadHistoryFile,
  uploadHistoryImage,
  uploadSalesRaw,
} from '../history-service.js';

function baseCtx(overrides = {}) {
  return {
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    pickMyStoreFromState: () => '',
    isForecastStoreScopedRole: () => false,
    canAccessAnalyticsReports: (role) => role === 'admin' || role === 'store_manager',
    normalizeForecastBizType: (v) => String(v || '').trim(),
    normalizeForecastSlot: (v) => String(v || '').trim(),
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    },
    shiftForecastDate: (d, _days) => d,
    loadInventoryForecastHistoryFromSalesRaw: async () => [],
    ...overrides,
  };
}

test('listHistory: missing_user / forbidden / missing_store', async () => {
  const missing = await listHistory(baseCtx(), { username: '', role: 'admin', query: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await listHistory(baseCtx(), { username: 'bob', role: 'employee', query: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const missingStore = await listHistory(baseCtx(), { username: 'admin', role: 'admin', query: {} });
  assert.deepEqual(missingStore, { ok: false, status: 400, error: 'missing_store' });
});

test('listHistory: prefers pos_sales_detail rows over empty state history', async () => {
  const result = await listHistory(baseCtx({
    loadInventoryForecastHistoryFromSalesRaw: async () => [{ date: '2026-07-01' }, { date: '2026-07-02' }],
  }), {
    username: 'admin',
    role: 'admin',
    query: { store: '洪潮店', limit: 1 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.store, '洪潮店');
  assert.equal(result.storageSource, 'pos_sales_detail');
  assert.equal(result.items.length, 1);
});

test('listHistory: reports server_error on failure', async () => {
  const result = await listHistory(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', query: { store: 'A' } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('clearHistory: admin_only / clears matching store only / clears all', async () => {
  const forbidden = await clearHistory(baseCtx(), { role: 'employee', query: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'admin_only' });

  let saved = null;
  const scoped = await clearHistory(
    baseCtx({
      getSharedState: async () => ({
        inventoryForecastHistory: [{ store: 'A' }, { store: 'B' }],
        inventoryForecastPredictions: [{ store: 'A' }],
        inventoryForecastEvaluations: [{ store: 'A' }],
      }),
      saveSharedState: async (s) => { saved = s; },
    }),
    { role: 'admin', query: { store: 'A' }, body: {} }
  );
  assert.equal(scoped.ok, true);
  assert.equal(scoped.cleared, 1);
  assert.equal(scoped.remaining, 1);
  assert.equal(scoped.store, 'A');
  assert.deepEqual(saved.inventoryForecastHistory, [{ store: 'B' }]);

  const all = await clearHistory(
    baseCtx({
      getSharedState: async () => ({
        inventoryForecastHistory: [{ store: 'A' }, { store: 'B' }],
      }),
      saveSharedState: async () => {},
    }),
    { role: 'admin', query: {}, body: {} }
  );
  assert.equal(all.store, '(all)');
  assert.equal(all.remaining, 0);
});

test('clearHistory: reports server_error on failure', async () => {
  const result = await clearHistory(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { role: 'admin', query: {}, body: {} });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('batchHistory: validates biz type / slot / rows / store then upserts', async () => {
  const missing = await batchHistory(baseCtx(), { username: '', role: 'admin', body: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await batchHistory(baseCtx(), { username: 'bob', role: 'employee', body: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const invalidBiz = await batchHistory(baseCtx({ normalizeForecastBizType: () => '' }), {
    username: 'admin', role: 'admin', body: {},
  });
  assert.deepEqual(invalidBiz, { ok: false, status: 400, error: 'invalid_biz_type' });

  const invalidSlot = await batchHistory(baseCtx({ normalizeForecastSlot: () => '' }), {
    username: 'admin', role: 'admin', body: { bizType: 'dine_in' },
  });
  assert.deepEqual(invalidSlot, { ok: false, status: 400, error: 'invalid_slot' });

  const missingRows = await batchHistory(baseCtx(), {
    username: 'admin', role: 'admin', body: { bizType: 'dine_in', slot: 'lunch' },
  });
  assert.deepEqual(missingRows, { ok: false, status: 400, error: 'missing_rows' });

  const missingStore = await batchHistory(baseCtx(), {
    username: 'admin', role: 'admin', body: { bizType: 'dine_in', slot: 'lunch', rows: [{}] },
  });
  assert.deepEqual(missingStore, { ok: false, status: 400, error: 'missing_store' });

  let saved = null;
  const ok = await batchHistory(baseCtx({
    upsertInventoryForecastHistoryInState: (state0, opts) => ({
      state: { ...state0, touched: opts.store },
      inserted: 1, updated: 0, skipped: 0, accepted: 1, evaluated: 0,
    }),
    saveSharedState: async (s) => { saved = s; },
  }), {
    username: 'admin', role: 'admin',
    body: { store: '洪潮店', bizType: 'dine_in', slot: 'lunch', rows: [{ date: '2026-07-01' }] },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.store, '洪潮店');
  assert.equal(ok.inserted, 1);
  assert.equal(saved.touched, '洪潮店');
});

test('batchHistory: reports server_error on failure', async () => {
  const result = await batchHistory(baseCtx({
    getSharedState: async () => { throw new Error('db down'); },
  }), { username: 'admin', role: 'admin', body: { bizType: 'dine_in', slot: 'lunch', rows: [{}] } });
  assert.deepEqual(result, { ok: false, status: 500, error: 'server_error', message: 'internal_error' });
});

test('uploadHistoryFile: delegates to runUploadHistoryFile helper', async () => {
  const result = await uploadHistoryFile(baseCtx(), { username: '', role: 'admin', body: {} });
  assert.deepEqual(result, { ok: false, status: 400, error: 'missing_user' });
});

test('uploadHistoryImage: always returns disabled response', async () => {
  const result = await uploadHistoryImage({}, {});
  assert.deepEqual(result, {
    ok: false,
    status: 410,
    error: 'image_upload_disabled',
    message: '图片上传功能已下线，请使用 Excel 或 PDF 上传历史数据。',
  });
});

test('uploadSalesRaw: validates access then returns retired response', async () => {
  const missing = await uploadSalesRaw(baseCtx(), { username: '', role: 'admin', body: {} });
  assert.deepEqual(missing, { ok: false, status: 400, error: 'missing_user' });

  const forbidden = await uploadSalesRaw(baseCtx(), { username: 'bob', role: 'employee', body: {} });
  assert.deepEqual(forbidden, { ok: false, status: 403, error: 'forbidden' });

  const retired = await uploadSalesRaw(baseCtx(), { username: 'admin', role: 'admin', body: {} });
  assert.deepEqual(retired, {
    ok: false,
    status: 410,
    error: 'sales_raw_retired',
    message: '销售明细已改为自动同步（pos_order_items/pos_sales_detail），不再需要手工上传销售明细文件。',
  });
});
