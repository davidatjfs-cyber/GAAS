import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePredictionItems,
  forecastPredictionToProductMap,
  calcForecastAccuracyMetrics,
  buildForecastCalibrationFactors,
  applyForecastCalibration,
  summarizeForecastAccuracyRows,
  createAccuracyHelpers,
} from '../accuracy.js';

test('normalizePredictionItems filters invalid rows and maps fields', () => {
  assert.deepEqual(normalizePredictionItems(null), []);
  assert.deepEqual(
    normalizePredictionItems([
      { product: ' 鱼片 ', qty: 1.239, reason: '热卖' },
      { product: '', qty: 3 },
      { product: '米饭', qty: -1 },
    ]),
    [{ product: '鱼片', qty: 1.24, reason: '热卖' }]
  );
});

test('forecastPredictionToProductMap aggregates duplicate products', () => {
  assert.deepEqual(
    forecastPredictionToProductMap([
      { product: 'A', qty: 1 },
      { product: 'A', qty: 2.5 },
      { product: 'B', qty: 3 },
    ]),
    { A: 3.5, B: 3 }
  );
});

test('calcForecastAccuracyMetrics computes mape / hitRate / topDiff', () => {
  const normalizeForecastProducts = (products) => {
    const map = {};
    for (const [k, v] of Object.entries(products || {})) map[k] = Number(v);
    return map;
  };
  const metrics = calcForecastAccuracyMetrics(
    normalizeForecastProducts,
    [
      { product: 'A', qty: 10 },
      { product: 'B', qty: 5 },
    ],
    { A: 10, B: 10, C: 2 }
  );
  assert.equal(metrics.productCount, 3);
  assert.equal(metrics.totalPredQty, 15);
  assert.equal(metrics.totalActualQty, 22);
  assert.ok(metrics.mape > 0);
  assert.ok(metrics.hitRate20 >= 0);
  assert.equal(metrics.topDiffProducts[0].product, 'B');
  assert.deepEqual(
    calcForecastAccuracyMetrics(normalizeForecastProducts, [], {}),
    {
      totalPredQty: 0,
      totalActualQty: 0,
      totalAbsError: 0,
      totalAccuracy: 1,
      mape: 1,
      hitRate20: 0,
      productCount: 0,
      perProduct: [],
      topDiffProducts: [],
    }
  );
});

test('buildForecastCalibrationFactors averages ratios and respects cutoff', () => {
  const empty = buildForecastCalibrationFactors([], '2026-07-01');
  assert.equal(empty.globalFactor, 1);
  assert.equal(empty.sampleCount, 0);

  const cal = buildForecastCalibrationFactors(
    [
      {
        date: '2026-06-01',
        perProduct: [
          { product: 'A', predQty: 10, actualQty: 12 },
          { product: 'A', predQty: 10, actualQty: 8 },
          { product: 'B', predQty: 5, actualQty: 5 },
        ],
      },
      {
        date: '2026-07-10',
        perProduct: [{ product: 'A', predQty: 100, actualQty: 1 }],
      },
      {
        date: '2026-06-02',
        perProduct: [{ product: '', predQty: 1, actualQty: 1 }],
      },
    ],
    '2026-07-01'
  );
  assert.ok(cal.globalFactor >= 0.65 && cal.globalFactor <= 1.35);
  assert.ok(cal.byProduct.A);
  assert.equal(cal.byProduct.B, undefined); // needs >=2 samples
  assert.ok(cal.sampleCount >= 2);
});

test('applyForecastCalibration scales qty by product/global factor', () => {
  const out = applyForecastCalibration(
    [
      { product: 'A', qty: 10, reason: 'x' },
      { product: 'B', qty: 10, reason: 'y' },
    ],
    { globalFactor: 1.2, byProduct: { A: 0.5 } }
  );
  assert.equal(out[0].product, 'B');
  assert.equal(out[0].qty, 12);
  assert.equal(out[1].product, 'A');
  assert.equal(out[1].qty, 5);
  assert.deepEqual(applyForecastCalibration([{ product: 'Z', qty: 2 }], null)[0].qty, 2);
});

test('summarizeForecastAccuracyRows aggregates module stats', () => {
  assert.equal(summarizeForecastAccuracyRows([]).comparedCount, 0);
  const summary = summarizeForecastAccuracyRows([
    {
      bizType: 'dinein',
      slot: 'lunch',
      totalAccuracy: 0.8,
      mape: 0.2,
      hitRate20: 0.5,
      totalPredQty: 10,
      totalActualQty: 12,
      totalAbsError: 2,
    },
    {
      bizType: 'dinein',
      slot: 'lunch',
      totalAccuracy: 0.6,
      mape: 0.4,
      hitRate20: 0.25,
      totalPredQty: 5,
      totalActualQty: 4,
      totalAbsError: 1,
    },
    {
      bizType: 'takeaway',
      slot: 'dinner',
      totalAccuracy: 1,
      mape: 0,
      hitRate20: 1,
      totalPredQty: 3,
      totalActualQty: 3,
      totalAbsError: 0,
    },
  ]);
  assert.equal(summary.comparedCount, 3);
  assert.equal(summary.avgAccuracy, 0.8);
  assert.equal(summary.moduleStats.length, 2);
  const lunch = summary.moduleStats.find((m) => m.slot === 'lunch');
  assert.equal(lunch.comparedCount, 2);
  assert.equal(lunch.avgAccuracy, 0.7);
});

test('createAccuracyHelpers wires normalizeForecastProducts into metrics', () => {
  const helpers = createAccuracyHelpers({
    normalizeForecastProducts: (p) => p || {},
  });
  const metrics = helpers.calcForecastAccuracyMetrics([{ product: 'X', qty: 2 }], { X: 2 });
  assert.equal(metrics.totalAccuracy, 1);
  assert.equal(typeof helpers.buildForecastCalibrationFactors, 'function');
  assert.equal(typeof helpers.applyForecastCalibration, 'function');
});
