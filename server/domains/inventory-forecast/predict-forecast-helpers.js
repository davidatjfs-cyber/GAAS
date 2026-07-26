/**
 * P4 peel: predictForecast helpers.
 */
import { randomUUID } from 'crypto';

export function parsePredictForecastInput(input, ctx) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

  const bizType = ctx.normalizeForecastBizType(input.body?.bizType);
  const slot = ctx.normalizeForecastSlot(input.body?.slot);
  const date = ctx.safeDateOnly(input.body?.date);
  const weather = ctx.normalizeForecastWeather(input.body?.weather);
  const isHoliday = !!(input.body?.isHoliday === true || input.body?.isHoliday === 1 || input.body?.isHoliday === '1' || String(input.body?.isHoliday || '').trim().toLowerCase() === 'true' || String(input.body?.isHoliday || '').trim() === '是');
  const expectedRevenue = ctx.safeNumber(input.body?.expectedRevenue);
  const topN = Math.max(5, Math.min(80, Number(input.body?.topN || 20) || 20));

  if (!bizType) return { ok: false, status: 400, error: 'invalid_biz_type' };
  if (!slot) return { ok: false, status: 400, error: 'invalid_slot' };
  if (!date) return { ok: false, status: 400, error: 'missing_date' };
  if (!Number.isFinite(expectedRevenue) || expectedRevenue < 0) return { ok: false, status: 400, error: 'invalid_expected_revenue' };

  return {
    ok: true,
    username,
    role,
    bizType,
    slot,
    date,
    weather,
    isHoliday,
    expectedRevenue,
    topN,
    qStore: String(input.body?.store || '').trim(),
  };
}

export async function loadPredictForecastHistory(ctx, { store, bizType, slot, date, aliasLookup, expectedRevenue }) {
  const historyWindowStart = ctx.shiftForecastDate(date, -180);
  const historyRowsRaw = await ctx.loadInventoryForecastHistoryFromSalesRaw({
    storeScope: [store],
    bizType,
    slot,
    startDate: historyWindowStart,
    endDate: date,
  });
  const historyRows = ctx.canonicalizeForecastRows(historyRowsRaw, aliasLookup);

  const slotShareRows = await ctx.loadInventoryForecastHistoryFromSalesRaw({
    storeScope: [store],
    bizType,
    startDate: historyWindowStart,
    endDate: date,
  });
  const slotSplit = ctx.computeSlotRevenueShare(slotShareRows, store, bizType, slot, date);
  const slotExpectedRevenue = Number((expectedRevenue * slotSplit.slotShare).toFixed(2));

  return { historyRows, slotSplit, slotExpectedRevenue, historyWindowStart };
}

export async function buildPredictForecastOutput(ctx, {
  state0,
  historyRows,
  target,
  topN,
  date,
  store,
  bizType,
  slot,
  expectedRevenue,
  username,
}) {
  const calibrationEvals = (Array.isArray(state0.inventoryForecastEvaluations) ? state0.inventoryForecastEvaluations : [])
    .filter((x) => String(x?.store || '').trim() === store)
    .filter((x) => ctx.normalizeForecastBizType(x?.bizType) === bizType)
    .filter((x) => ctx.normalizeForecastSlot(x?.slot) === slot);
  const calibration = ctx.buildForecastCalibrationFactors(calibrationEvals, date);

  const heuristic = ctx.buildForecastByHeuristic(historyRows, target, topN);
  let source = 'heuristic';
  let out = heuristic;

  try {
    const ai = await ctx.buildForecastByAI({ historyRows, target, topN, state0 });
    if (ai && Array.isArray(ai.predictions) && ai.predictions.length) {
      source = 'ai';
      out = ai;
    }
  } catch (_e) {
    source = 'heuristic';
  }

  const calibratedPredictionsRaw = ctx.applyForecastCalibration((out?.predictions || []).slice(), calibration).slice(0, topN);
  let calibratedPredictions = ctx.constrainPredictionsToHistory(calibratedPredictionsRaw, historyRows, topN);
  if (!calibratedPredictions.length) {
    const fallbackRaw = ctx.applyForecastCalibration((heuristic?.predictions || []).slice(), calibration).slice(0, topN);
    calibratedPredictions = ctx.constrainPredictionsToHistory(fallbackRaw, historyRows, topN);
  }

  const aliasLookup = ctx.buildForecastProductAliasLookup(state0, store);
  const coreTargets = (Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts : [])
    .filter((x) => String(x?.store || '').trim() === store)
    .filter((x) => !ctx.isExcludedForecastProduct(x?.product));
  const predMap = new Map(calibratedPredictions.map((x) => [String(x?.product || '').trim(), Number(x?.qty || 0)]));
  const coreTargetUsage = coreTargets
    .map((t) => {
      const product = String(t?.product || '').trim();
      const targetQty = Number(t?.targetQty || 0);
      const predictedQty = Number(predMap.get(ctx.resolveForecastProductName(product, aliasLookup).display) || 0);
      const coverageRate = targetQty > 0 ? Math.max(0, Number((predictedQty / targetQty).toFixed(4))) : 0;
      return {
        product,
        targetQty: Number(targetQty.toFixed(1)),
        predictedQty: Number(predictedQty.toFixed(1)),
        gapQty: Number((targetQty - predictedQty).toFixed(1)),
        coverageRate: Number((coverageRate * 100).toFixed(1)),
      };
    })
    .filter((x) => x.product)
    .sort((a, b) => a.gapQty - b.gapQty);

  const summaryRaw = String(out?.summary || '').trim();
  const calibrationText = calibration.sampleCount > 0
    ? `自校准系数${Number(calibration.globalFactor || 1).toFixed(2)}（样本${calibration.sampleCount}）`
    : '暂无足够样本进行自校准。';
  const summary = summaryRaw ? `${summaryRaw} ${calibrationText}` : calibrationText;

  return {
    source,
    out,
    calibration,
    calibratedPredictions,
    coreTargetUsage,
    summary,
    predictionBundle: buildPredictionStatePatch({
      state0,
      store,
      bizType,
      slot,
      date,
      weather: target.weather,
      isHoliday: target.isHoliday,
      expectedRevenue,
      source,
      out,
      summary,
      calibratedPredictions,
      calibration,
      historyRows,
      username,
      ctx,
    }),
  };
}

function forecastKeyOf(x) {
  return `${String(x?.store || '').trim()}||${String(x?.bizType || '').trim()}||${String(x?.slot || '').trim()}||${String(x?.date || '').trim()}`;
}

function buildPredictionStatePatch({
  state0,
  store,
  bizType,
  slot,
  date,
  weather,
  isHoliday,
  expectedRevenue,
  source,
  out,
  summary,
  calibratedPredictions,
  calibration,
  historyRows,
  username,
  ctx,
}) {
  const now = ctx.hrmsNowISO();
  const predictionList = Array.isArray(state0.inventoryForecastPredictions) ? state0.inventoryForecastPredictions.slice() : [];
  const key = `${store}||${bizType}||${slot}||${date}`;
  const idx = predictionList.findIndex((x) => forecastKeyOf(x) === key);
  const prev = idx >= 0 ? (predictionList[idx] || {}) : null;
  const predictionItem = {
    ...(prev || {}),
    id: prev?.id || randomUUID(),
    store,
    bizType,
    slot,
    date,
    weather,
    isHoliday,
    expectedRevenue: Number(expectedRevenue.toFixed(2)),
    source,
    confidence: Number(out?.confidence || 0),
    summary,
    predictions: calibratedPredictions,
    calibration,
    historyCount: historyRows.length,
    createdAt: prev?.createdAt || now,
    createdBy: prev?.createdBy || username,
    updatedAt: now,
    updatedBy: username,
  };
  if (idx >= 0) predictionList.splice(idx, 1, predictionItem);
  else predictionList.unshift(predictionItem);

  const actualOnDate = historyRows.find((x) => String(x?.date || '').trim() === date);
  let immediateEval = null;
  let nextEvaluations = Array.isArray(state0.inventoryForecastEvaluations) ? state0.inventoryForecastEvaluations.slice() : [];
  if (actualOnDate) {
    const metrics = ctx.calcForecastAccuracyMetrics(predictionItem.predictions, actualOnDate.productQuantities);
    const evalKey = key;
    const evalIdx = nextEvaluations.findIndex((x) => forecastKeyOf(x) === evalKey);
    const prevEval = evalIdx >= 0 ? (nextEvaluations[evalIdx] || {}) : null;
    const evalItem = {
      ...(prevEval || {}),
      id: prevEval?.id || randomUUID(),
      predictionId: predictionItem.id,
      store,
      bizType,
      slot,
      date,
      totalPredQty: metrics.totalPredQty,
      totalActualQty: metrics.totalActualQty,
      totalAbsError: metrics.totalAbsError,
      totalAccuracy: metrics.totalAccuracy,
      mape: metrics.mape,
      hitRate20: metrics.hitRate20,
      productCount: metrics.productCount,
      perProduct: metrics.perProduct,
      topDiffProducts: metrics.topDiffProducts,
      evaluatedAt: now,
      updatedAt: now,
      updatedBy: username,
    };
    immediateEval = evalItem;
    if (evalIdx >= 0) nextEvaluations.splice(evalIdx, 1, evalItem);
    else nextEvaluations.unshift(evalItem);
    nextEvaluations = nextEvaluations.slice(0, 6000);
  }

  return {
    now,
    predictionList: predictionList.slice(0, 6000),
    nextEvaluations,
    immediateEval,
    predictionItem,
  };
}

export async function persistPredictForecastState(ctx, state0, predictionBundle) {
  await ctx.saveSharedState({
    ...state0,
    inventoryForecastPredictions: predictionBundle.predictionList,
    inventoryForecastEvaluations: predictionBundle.nextEvaluations,
  });
}
