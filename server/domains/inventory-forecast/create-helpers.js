import {
  normalizeProductName,
  resolveForecastProductName,
  forecastDayTypeLabel,
  normalizeForecastWeatherTag,
  createProductAliasHelpers,
} from './product-normalize.js';
import {
  STORE_FORECAST_CONFIG,
  createGetStoreForecastConfig,
  isCNYPeriod,
  KNOWN_PUBLIC_HOLIDAYS,
  isKnownPublicHoliday,
  isNormalWorkday,
} from './calendar-config.js';
import { createResolveForecastScope } from './scope.js';
import {
  isForecastStoreScopedRole,
  normalizeForecastBizType,
  createForecastBrandToken,
  STORE_SLOT_CONFIG,
  createGetStoreSlotConfig,
  normalizeForecastSlot,
  resolveSlotForHour,
  createNormalizeForecastSlotFromHourRange,
  createNormalizeForecastUploadDate,
  inferForecastUploadDateFromFilename,
  normalizeForecastWeather,
  normalizeForecastStoreName,
  normalizeForecastStoreKey,
  createShiftForecastDate,
  forecastHistoryRowKey,
  sortForecastHistoryRows,
  mergePreferredForecastHistoryRows,
} from './normalize.js';
import { createParseInventoryForecastRowsFromTableMatrix } from './table-parse.js';
import {
  FORECAST_EXCLUDED_PRODUCTS,
  isExcludedForecastProduct,
  createNormalizeForecastProducts,
  scoreForecastRow,
  buildForecastByHeuristic,
  extractHistoryProductUniverse,
  createConstrainPredictionsToHistory,
  createComputeSlotRevenueShare,
} from './heuristic.js';
import { createAccuracyHelpers } from './accuracy.js';
import { createEstimateHelpers } from './estimate.js';

export function createInventoryForecastHelpers({
  safeDateOnly,
  safeNumber,
  inDateRange,
  normalizeBrandId,
  resolveStoreBrandContext,
  resolveTenantIdDefault,
  getBrandForStoreSync,
  getBrandConfigSync,
  pickMyStoreFromState,
  getBrandsFromState,
  getStoreNamesByBrand,
}) {
  const getStoreForecastConfig = createGetStoreForecastConfig({
    resolveTenantIdDefault,
    getBrandForStoreSync,
    getBrandConfigSync,
  });

  const {
    buildForecastProductAliasLookup,
    canonicalizeForecastProductQuantities,
    canonicalizeForecastRows,
  } = createProductAliasHelpers({
    normalizeBrandId,
    resolveStoreBrandContext,
    isExcludedForecastProduct,
  });

  const forecastBrandToken = createForecastBrandToken({
    getBrandForStoreSync,
    resolveTenantIdDefault,
  });

  const getStoreSlotConfig = createGetStoreSlotConfig({
    resolveTenantIdDefault,
    getBrandForStoreSync,
    getBrandConfigSync,
  });

  const normalizeForecastSlotFromHourRange = createNormalizeForecastSlotFromHourRange({
    getStoreSlotConfig,
  });

  const normalizeForecastUploadDate = createNormalizeForecastUploadDate({ safeDateOnly });
  const shiftForecastDate = createShiftForecastDate({ safeDateOnly });

  const normalizeForecastProducts = createNormalizeForecastProducts({ safeNumber });

  const {
    normalizePredictionItems,
    forecastPredictionToProductMap,
    calcForecastAccuracyMetrics,
    buildForecastCalibrationFactors,
    applyForecastCalibration,
    summarizeForecastAccuracyRows,
  } = createAccuracyHelpers({ normalizeForecastProducts });

  const constrainPredictionsToHistory = createConstrainPredictionsToHistory({
    normalizePredictionItems,
  });

  const computeSlotRevenueShare = createComputeSlotRevenueShare({ safeDateOnly });

  const parseInventoryForecastRowsFromTableMatrix = createParseInventoryForecastRowsFromTableMatrix({
    normalizeForecastUploadDate,
    normalizeForecastBizType,
    normalizeForecastStoreName,
    normalizeForecastWeather,
    normalizeForecastSlotFromHourRange,
    isExcludedForecastProduct,
  });

  const {
    estimateRevenueByHistory,
    normalizeGrossProfitProfileItem,
    computeAvgPricePerProduct,
    canManageGrossProfitProfiles,
    normalizeDishAliasBizType,
    estimateGrossMarginByHistory,
  } = createEstimateHelpers({
    safeDateOnly,
    safeNumber,
    inDateRange,
    normalizeForecastBizType,
    normalizeForecastWeather,
    normalizeForecastWeatherTag,
    getStoreForecastConfig,
    isKnownPublicHoliday,
    isCNYPeriod,
    isNormalWorkday,
    resolveForecastProductName,
    isExcludedForecastProduct,
  });

  const resolveForecastScope = createResolveForecastScope({
    isForecastStoreScopedRole,
    pickMyStoreFromState,
    normalizeBrandId,
    resolveStoreBrandContext,
    getBrandsFromState,
    getStoreNamesByBrand,
  });

  return {
    // scope
    resolveForecastScope,
    isForecastStoreScopedRole,

    // product normalize
    normalizeProductName,
    resolveForecastProductName,
    forecastDayTypeLabel,
    normalizeForecastWeatherTag,
    buildForecastProductAliasLookup,
    canonicalizeForecastProductQuantities,
    canonicalizeForecastRows,

    // calendar / store forecast config
    STORE_FORECAST_CONFIG,
    getStoreForecastConfig,
    isCNYPeriod,
    KNOWN_PUBLIC_HOLIDAYS,
    isKnownPublicHoliday,
    isNormalWorkday,

    // estimate / profiles
    estimateRevenueByHistory,
    normalizeGrossProfitProfileItem,
    computeAvgPricePerProduct,
    canManageGrossProfitProfiles,
    normalizeDishAliasBizType,
    estimateGrossMarginByHistory,

    // accuracy
    normalizePredictionItems,
    forecastPredictionToProductMap,
    calcForecastAccuracyMetrics,
    buildForecastCalibrationFactors,
    applyForecastCalibration,
    summarizeForecastAccuracyRows,

    // normalize / slots / history keys
    normalizeForecastBizType,
    forecastBrandToken,
    STORE_SLOT_CONFIG,
    getStoreSlotConfig,
    normalizeForecastSlot,
    resolveSlotForHour,
    normalizeForecastSlotFromHourRange,
    normalizeForecastUploadDate,
    inferForecastUploadDateFromFilename,
    normalizeForecastWeather,
    normalizeForecastStoreName,
    normalizeForecastStoreKey,
    shiftForecastDate,
    forecastHistoryRowKey,
    sortForecastHistoryRows,
    mergePreferredForecastHistoryRows,

    // table parse
    parseInventoryForecastRowsFromTableMatrix,

    // heuristic / products
    FORECAST_EXCLUDED_PRODUCTS,
    isExcludedForecastProduct,
    normalizeForecastProducts,
    scoreForecastRow,
    buildForecastByHeuristic,
    extractHistoryProductUniverse,
    constrainPredictionsToHistory,
    computeSlotRevenueShare,
  };
}
