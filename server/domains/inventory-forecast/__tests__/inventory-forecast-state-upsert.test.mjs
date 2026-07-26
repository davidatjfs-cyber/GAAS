/**
 * domains/inventory-forecast/state-upsert.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateUpsertHelpers } from '../state-upsert.js';

function make(overrides = {}) {
  let n = 0;
  return createStateUpsertHelpers({
    hrmsNowISO: () => '2026-07-26T12:00:00+08:00',
    randomUUID: () => `id-${++n}`,
    calcForecastAccuracyMetrics: () => ({
      totalPredQty: 10,
      totalActualQty: 8,
      totalAbsError: 2,
      totalAccuracy: 0.8,
      mape: 0.2,
      hitRate20: 1,
      productCount: 1,
      perProduct: {},
      topDiffProducts: [],
    }),
    safeDateOnly: (v) => {
      const s = String(v || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
    },
    safeNumber: (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    },
    normalizeForecastWeather: (w) => String(w || '').trim() || 'sunny',
    normalizeForecastProducts: (p) => {
      if (!p || typeof p !== 'object') return {};
      const out = {};
      for (const [k, v] of Object.entries(p)) {
        const q = Number(v);
        if (Number.isFinite(q) && q > 0) out[k] = q;
      }
      return out;
    },
    ...overrides,
  });
}

test('parseForecastHistoryRow：isHoliday 变体 / 无 products / 营收字段', () => {
  const { parseForecastHistoryRow } = make();
  assert.equal(parseForecastHistoryRow(null), null);
  assert.equal(parseForecastHistoryRow({ date: 'bad', products: { a: 1 } }), null);
  assert.equal(parseForecastHistoryRow({ date: '2026-07-01', products: {} }), null);

  for (const isHoliday of [true, 1, '1', 'true', '是']) {
    const row = parseForecastHistoryRow({
      date: '2026-07-01',
      isHoliday,
      products: { 菜A: 2 },
      forecastRevenue: 100.456,
      actualRevenue: 90,
      totalDiscount: 5,
      weather: '雨',
    });
    assert.equal(row.isHoliday, true);
    assert.equal(row.expectedRevenue, 100.46);
    assert.equal(row.actualRevenue, 90);
    assert.equal(row.productQuantities['菜A'], 2);
  }
  assert.equal(
    parseForecastHistoryRow({ date: '2026-07-01', isHoliday: false, products: { a: 1 } }).isHoliday,
    false
  );
});

test('upsertInventoryForecastHistoryInState：insert/update/skip/evaluate', () => {
  const { upsertInventoryForecastHistoryInState } = make();
  const state0 = {
    inventoryForecastHistory: [],
    inventoryForecastPredictions: [
      {
        id: 'pred-1',
        store: 'S1',
        bizType: '堂食',
        slot: '午',
        date: '2026-07-01',
        predictions: { 菜A: 3 },
      },
    ],
    inventoryForecastEvaluations: [],
  };

  const first = upsertInventoryForecastHistoryInState(state0, {
    store: 'S1',
    bizType: '堂食',
    slot: '午',
    username: 'u1',
    rowsRaw: [
      { date: 'bad' },
      { date: '2026-07-01', products: { 菜A: 2 }, actualRevenue: 80 },
    ],
  });
  assert.equal(first.inserted, 1);
  assert.equal(first.skipped, 1);
  assert.equal(first.evaluated, 1);
  assert.equal(first.state.inventoryForecastEvaluations[0].predictionId, 'pred-1');
  assert.equal(first.state.inventoryForecastHistory[0].id, 'id-1');

  const second = upsertInventoryForecastHistoryInState(first.state, {
    store: 'S1',
    bizType: '堂食',
    slot: '午',
    username: 'u2',
    rowsRaw: [{ date: '2026-07-01', products: { 菜A: 4 }, actualRevenue: 88 }],
  });
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.state.inventoryForecastHistory[0].productQuantities['菜A'], 4);
  assert.equal(second.state.inventoryForecastHistory[0].updatedBy, 'u2');
  assert.equal(second.state.inventoryForecastHistory[0].createdBy, 'u1');
});
