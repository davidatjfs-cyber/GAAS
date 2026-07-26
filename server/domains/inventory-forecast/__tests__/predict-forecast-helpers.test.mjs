import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePredictForecastInput,
  loadPredictForecastHistory,
  buildPredictForecastOutput,
  persistPredictForecastState,
} from '../predict-forecast-helpers.js';

const ctx = {
  canAccessAnalyticsReports: (role) => role === 'admin',
  normalizeForecastBizType: (v) => String(v || '').trim() || null,
  normalizeForecastSlot: (v) => String(v || '').trim() || null,
  safeDateOnly: (v) => String(v || '').slice(0, 10) || null,
  normalizeForecastWeather: (v) => String(v || '').trim(),
  safeNumber: (v) => Number(v),
  shiftForecastDate: (d, days) => {
    const base = new Date(`${d}T00:00:00`);
    base.setDate(base.getDate() + days);
    return base.toISOString().slice(0, 10);
  },
  loadInventoryForecastHistoryFromSalesRaw: async () => [],
  canonicalizeForecastRows: (rows) => rows,
  computeSlotRevenueShare: () => ({ slotShare: 0.5, splitMode: 'history' }),
  buildForecastCalibrationFactors: () => ({ globalFactor: 1.05, sampleCount: 3 }),
  buildForecastByHeuristic: () => ({
    predictions: [{ product: '牛腩', qty: 10 }],
    confidence: 0.7,
    summary: '启发式预测',
  }),
  buildForecastByAI: async () => null,
  applyForecastCalibration: (preds) => preds,
  constrainPredictionsToHistory: (preds) => preds,
  buildForecastProductAliasLookup: () => new Map(),
  isExcludedForecastProduct: () => false,
  resolveForecastProductName: (name) => ({ display: name, key: name }),
  hrmsNowISO: () => '2026-07-25T12:00:00.000Z',
  calcForecastAccuracyMetrics: () => ({
    totalPredQty: 10,
    totalActualQty: 9,
    totalAbsError: 1,
    totalAccuracy: 0.9,
    mape: 0.1,
    hitRate20: 0.8,
    productCount: 1,
    perProduct: [],
    topDiffProducts: [],
  }),
  saveSharedState: async () => {},
};

test('parsePredictForecastInput: missing_user', () => {
  const out = parsePredictForecastInput({ username: '', role: 'admin', body: {} }, ctx);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'missing_user');
});

test('parsePredictForecastInput: forbidden role', () => {
  const out = parsePredictForecastInput({ username: 'u1', role: 'store_employee', body: {} }, ctx);
  assert.equal(out.ok, false);
  assert.equal(out.status, 403);
});

test('parsePredictForecastInput: invalid_biz_type / invalid_slot / missing_date', () => {
  const base = { username: 'u1', role: 'admin', body: { slot: 'lunch', date: '2026-07-24', expectedRevenue: 100 } };
  assert.equal(parsePredictForecastInput({ ...base, body: { ...base.body, bizType: '' } }, ctx).error, 'invalid_biz_type');
  assert.equal(parsePredictForecastInput({ ...base, body: { ...base.body, bizType: 'dine', slot: '' } }, ctx).error, 'invalid_slot');
  assert.equal(parsePredictForecastInput({ ...base, body: { ...base.body, bizType: 'dine', date: '' } }, ctx).error, 'missing_date');
});

test('parsePredictForecastInput: invalid_expected_revenue', () => {
  const out = parsePredictForecastInput({
    username: 'u1',
    role: 'admin',
    body: { bizType: 'dine', slot: 'lunch', date: '2026-07-24', expectedRevenue: -1 },
  }, ctx);
  assert.equal(out.ok, false);
  assert.equal(out.error, 'invalid_expected_revenue');
});

test('parsePredictForecastInput: valid payload with holiday and topN clamp', () => {
  const out = parsePredictForecastInput({
    username: 'u1',
    role: 'admin',
    body: {
      bizType: 'dine',
      slot: 'lunch',
      date: '2026-07-24',
      expectedRevenue: 10000,
      topN: 200,
      store: '洪潮店',
      isHoliday: 'true',
      weather: '晴',
    },
  }, ctx);
  assert.equal(out.ok, true);
  assert.equal(out.bizType, 'dine');
  assert.equal(out.topN, 80);
  assert.equal(out.qStore, '洪潮店');
  assert.equal(out.isHoliday, true);
});

test('parsePredictForecastInput: topN minimum clamp', () => {
  const out = parsePredictForecastInput({
    username: 'u1',
    role: 'admin',
    body: { bizType: 'dine', slot: 'lunch', date: '2026-07-24', expectedRevenue: 100, topN: 1 },
  }, ctx);
  assert.equal(out.topN, 5);
});

test('loadPredictForecastHistory: computes slot expected revenue', async () => {
  const historyCtx = {
    ...ctx,
    loadInventoryForecastHistoryFromSalesRaw: async ({ slot }) => (
      slot ? [{ date: '2026-07-24', productQuantities: { 牛腩: 5 } }] : [{ date: '2026-07-24' }]
    ),
    computeSlotRevenueShare: () => ({ slotShare: 0.4, splitMode: 'avg' }),
  };
  const out = await loadPredictForecastHistory(historyCtx, {
    store: '洪潮店',
    bizType: 'dine',
    slot: 'lunch',
    date: '2026-07-24',
    aliasLookup: new Map(),
    expectedRevenue: 10000,
  });
  assert.equal(out.slotExpectedRevenue, 4000);
  assert.equal(out.historyRows.length, 1);
  assert.equal(out.slotSplit.slotShare, 0.4);
});

test('buildPredictForecastOutput: heuristic path with core targets and immediate eval', async () => {
  const state0 = {
    inventoryForecastEvaluations: [{ store: '洪潮店', bizType: 'dine', slot: 'lunch' }],
    forecastCoreProducts: [{ store: '洪潮店', product: '牛腩', targetQty: 20 }],
    inventoryForecastPredictions: [{
      store: '洪潮店',
      bizType: 'dine',
      slot: 'lunch',
      date: '2026-07-24',
      id: 'pred-old',
      createdAt: '2026-07-20T00:00:00.000Z',
      createdBy: 'old-user',
    }],
  };
  const historyRows = [{
    date: '2026-07-24',
    productQuantities: { 牛腩: 8 },
  }];
  const built = await buildPredictForecastOutput(ctx, {
    state0,
    historyRows,
    target: { weather: '晴', isHoliday: false },
    topN: 10,
    date: '2026-07-24',
    store: '洪潮店',
    bizType: 'dine',
    slot: 'lunch',
    expectedRevenue: 5000,
    username: 'admin',
  });
  assert.equal(built.source, 'heuristic');
  assert.ok(built.summary.includes('自校准系数'));
  assert.equal(built.coreTargetUsage.length, 1);
  assert.equal(built.coreTargetUsage[0].product, '牛腩');
  assert.ok(built.predictionBundle.immediateEval);
  assert.equal(built.predictionBundle.predictionItem.updatedBy, 'admin');
  assert.equal(built.predictionBundle.predictionItem.id, 'pred-old');
});

test('buildPredictForecastOutput: AI success and empty calibration fallback', async () => {
  let constrainCalls = 0;
  const aiCtx = {
    ...ctx,
    buildForecastByAI: async () => ({
      predictions: [{ product: 'AI菜', qty: 15 }],
      confidence: 0.9,
      summary: 'AI预测',
    }),
    buildForecastCalibrationFactors: () => ({ globalFactor: 1, sampleCount: 0 }),
    constrainPredictionsToHistory: (preds) => {
      constrainCalls += 1;
      return constrainCalls === 1 ? [] : preds;
    },
  };
  const built = await buildPredictForecastOutput(aiCtx, {
    state0: { forecastCoreProducts: [] },
    historyRows: [{ date: '2026-07-23', productQuantities: {} }],
    target: { weather: '', isHoliday: false },
    topN: 5,
    date: '2026-07-24',
    store: '洪潮店',
    bizType: 'dine',
    slot: 'lunch',
    expectedRevenue: 3000,
    username: 'u1',
  });
  assert.equal(built.source, 'ai');
  assert.match(built.summary, /暂无足够样本/);
  assert.equal(built.calibratedPredictions.length, 1);
});

test('buildPredictForecastOutput: AI throws falls back to heuristic', async () => {
  const errCtx = {
    ...ctx,
    buildForecastByAI: async () => { throw new Error('ai down'); },
  };
  const built = await buildPredictForecastOutput(errCtx, {
    state0: {},
    historyRows: [],
    target: { weather: '', isHoliday: false },
    topN: 5,
    date: '2026-07-24',
    store: '洪潮店',
    bizType: 'dine',
    slot: 'lunch',
    expectedRevenue: 1000,
    username: 'u1',
  });
  assert.equal(built.source, 'heuristic');
});

test('persistPredictForecastState: saves predictions and evaluations', async () => {
  let saved = null;
  const persistCtx = {
    ...ctx,
    saveSharedState: async (s) => { saved = s; },
  };
  await persistPredictForecastState(persistCtx, { foo: 1 }, {
    predictionList: [{ id: 'p1' }],
    nextEvaluations: [{ id: 'e1' }],
  });
  assert.deepEqual(saved.inventoryForecastPredictions, [{ id: 'p1' }]);
  assert.deepEqual(saved.inventoryForecastEvaluations, [{ id: 'e1' }]);
  assert.equal(saved.foo, 1);
});
