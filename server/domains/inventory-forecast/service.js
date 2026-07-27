/**
 * Inventory forecast + sales-raw dish-alias — pure business logic (no req/res).
 * Returns { ok, status?, error?, message?, ...payload }.
 */
import {
  parsePredictForecastInput,
  loadPredictForecastHistory,
  buildPredictForecastOutput,
  persistPredictForecastState,
} from './predict-forecast-helpers.js';
export {
  listDishAliases,
  createDishAlias,
  updateDishAlias,
  deleteDishAlias,
} from './dish-alias-service.js';
export {
  listProductAliases,
  createProductAlias,
  updateProductAlias,
  deleteProductAlias,
} from './product-alias-service.js';
export {
  listCoreProducts,
  createCoreProduct,
  deleteCoreProduct,
} from './core-product-service.js';
export {
  listHistory,
  clearHistory,
  batchHistory,
  uploadHistoryFile,
  uploadHistoryImage,
  uploadSalesRaw,
} from './history-service.js';
export {
  getCoreProductSales,
  getAnalytics,
} from './analytics-service.js';
export {
  estimateRevenue,
  getAccuracy,
} from './revenue-service.js';
export {
  listGrossProfitProfiles,
  upsertGrossProfitProfiles,
  updateGrossProfitProfile,
  deleteGrossProfitProfile,
  estimateGrossMargin,
} from './gross-profit-service.js';

export async function predictForecast(ctx, input) {
  const parsed = parsePredictForecastInput(input, ctx);
  if (!parsed.ok) return parsed;

  const {
    username,
    role,
    bizType,
    slot,
    date,
    weather,
    isHoliday,
    expectedRevenue,
    topN,
    qStore,
  } = parsed;

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const myStore = ctx.pickMyStoreFromState(state0, username);
    const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
    if (!store) return { ok: false, status: 400, error: 'missing_store' };

    const aliasLookup = ctx.buildForecastProductAliasLookup(state0, store);
    const { historyRows, slotSplit, slotExpectedRevenue } = await loadPredictForecastHistory(ctx, {
      store,
      bizType,
      slot,
      date,
      aliasLookup,
      expectedRevenue,
    });

    const target = {
      store,
      bizType,
      slot,
      date,
      weather,
      isHoliday,
      expectedRevenue: slotExpectedRevenue,
    };

    const built = await buildPredictForecastOutput(ctx, {
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
    });

    await persistPredictForecastState(ctx, state0, built.predictionBundle);

    return {
      ok: true,
      store,
      bizType,
      slot,
      target,
      slotSplit: {
        inputRevenue: Number(expectedRevenue.toFixed(2)),
        slotShare: slotSplit.slotShare,
        slotRevenue: slotExpectedRevenue,
        splitMode: slotSplit.splitMode,
      },
      historyCount: historyRows.length,
      source: built.source,
      confidence: Number(built.out?.confidence || 0),
      summary: built.summary,
      predictions: built.calibratedPredictions,
      calibration: built.calibration,
      immediateAccuracy: built.predictionBundle.immediateEval ? {
        totalAccuracy: built.predictionBundle.immediateEval.totalAccuracy,
        mape: built.predictionBundle.immediateEval.mape,
        hitRate20: built.predictionBundle.immediateEval.hitRate20,
      } : null,
      coreTargetUsage: built.coreTargetUsage,
      generatedAt: built.predictionBundle.now,
    };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
