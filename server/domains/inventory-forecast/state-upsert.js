export function createStateUpsertHelpers({
  hrmsNowISO,
  randomUUID,
  calcForecastAccuracyMetrics,
  safeDateOnly,
  safeNumber,
  normalizeForecastWeather,
  normalizeForecastProducts,
}) {
  function parseForecastHistoryRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const date = safeDateOnly(raw?.date);
    if (!date) return null;
    const weather = normalizeForecastWeather(raw?.weather);
    const isHoliday = !!(raw?.isHoliday === true || raw?.isHoliday === 1 || raw?.isHoliday === '1' || String(raw?.isHoliday || '').trim().toLowerCase() === 'true' || String(raw?.isHoliday || '').trim() === '是');
    const expectedRevenue = safeNumber(raw?.expectedRevenue ?? raw?.forecastRevenue ?? raw?.revenue);
    const actualRevenue = safeNumber(raw?.actualRevenue);
    const totalDiscount = safeNumber(raw?.totalDiscount);
    const productQuantities = normalizeForecastProducts(raw?.productQuantities ?? raw?.products);
    if (!Object.keys(productQuantities).length) return null;
    return {
      date,
      weather,
      isHoliday,
      expectedRevenue: Number.isFinite(expectedRevenue) ? Number(expectedRevenue.toFixed(2)) : 0,
      actualRevenue: Number.isFinite(actualRevenue) ? Number(actualRevenue.toFixed(2)) : 0,
      totalDiscount: Number.isFinite(totalDiscount) ? Number(totalDiscount.toFixed(2)) : 0,
      productQuantities
    };
  }

  function upsertInventoryForecastHistoryInState(state0, { store, bizType, slot, rowsRaw, username }) {
    const history = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory.slice() : [];
    const predictionList = Array.isArray(state0.inventoryForecastPredictions) ? state0.inventoryForecastPredictions.slice() : [];
    const evaluationList = Array.isArray(state0.inventoryForecastEvaluations) ? state0.inventoryForecastEvaluations.slice() : [];
    const keyOf = (x) => `${String(x?.store || '').trim()}||${String(x?.bizType || '').trim()}||${String(x?.slot || '').trim()}||${String(x?.date || '').trim()}`;
    const map = new Map();
    history.forEach((x) => map.set(keyOf(x), x));
    const predMap = new Map();
    predictionList.forEach((x) => predMap.set(keyOf(x), x));
    const evalMap = new Map();
    evaluationList.forEach((x) => evalMap.set(keyOf(x), x));

    const now = hrmsNowISO();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const touchedKeys = new Set();

    (Array.isArray(rowsRaw) ? rowsRaw : []).forEach((raw) => {
      const normalized = parseForecastHistoryRow(raw);
      if (!normalized) {
        skipped += 1;
        return;
      }
      const k = `${store}||${bizType}||${slot}||${normalized.date}`;
      const prev = map.get(k);
      const nextItem = {
        ...(prev || {}),
        id: prev?.id || randomUUID(),
        store,
        bizType,
        slot,
        date: normalized.date,
        weather: normalized.weather,
        isHoliday: normalized.isHoliday,
        expectedRevenue: normalized.expectedRevenue,
        actualRevenue: normalized.actualRevenue || 0,
        totalDiscount: normalized.totalDiscount || 0,
        productQuantities: normalized.productQuantities,
        createdAt: prev?.createdAt || now,
        createdBy: prev?.createdBy || username,
        updatedAt: now,
        updatedBy: username
      };
      if (prev) updated += 1;
      else inserted += 1;
      map.set(k, nextItem);
      touchedKeys.add(k);
    });

    let evaluated = 0;
    touchedKeys.forEach((k) => {
      const actualRow = map.get(k);
      const predRow = predMap.get(k);
      if (!actualRow || !predRow) return;
      const metrics = calcForecastAccuracyMetrics(predRow?.predictions, actualRow?.productQuantities);
      const prevEval = evalMap.get(k);
      evalMap.set(k, {
        ...(prevEval || {}),
        id: prevEval?.id || randomUUID(),
        predictionId: String(predRow?.id || '').trim(),
        store,
        bizType,
        slot,
        date: String(actualRow?.date || ''),
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
        updatedBy: username
      });
      evaluated += 1;
    });

    const nextHistory = Array.from(map.values()).sort((a, b) => {
      const aDate = String(a?.date || '');
      const bDate = String(b?.date || '');
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return String(b?.updatedAt || b?.createdAt || '').localeCompare(String(a?.updatedAt || a?.createdAt || ''));
    });
    const nextEvaluations = Array.from(evalMap.values())
      .sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')) || String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
      .slice(0, 6000);

    return {
      state: { ...state0, inventoryForecastHistory: nextHistory, inventoryForecastEvaluations: nextEvaluations },
      inserted,
      updated,
      skipped,
      accepted: inserted + updated,
      evaluated
    };
  }

  return {
    parseForecastHistoryRow,
    upsertInventoryForecastHistoryInState,
  };
}
