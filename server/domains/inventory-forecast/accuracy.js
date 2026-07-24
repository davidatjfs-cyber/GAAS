export function createAccuracyHelpers({ normalizeForecastProducts }) {
  function normalizePredictionItems(input) {
    const arr = Array.isArray(input) ? input : [];
    return arr
      .map((x) => ({
        product: String(x?.product || '').trim(),
        qty: Number(Number(x?.qty || 0).toFixed(2)),
        reason: String(x?.reason || '').trim()
      }))
      .filter((x) => x.product && Number.isFinite(x.qty) && x.qty >= 0);
  }

  function forecastPredictionToProductMap(predictions) {
    const map = {};
    normalizePredictionItems(predictions).forEach((x) => {
      map[x.product] = Number((Number(map[x.product] || 0) + Number(x.qty || 0)).toFixed(2));
    });
    return map;
  }

  function calcForecastAccuracyMetrics(predictions, actualProducts) {
    const predMap = forecastPredictionToProductMap(predictions);
    const actualMap = normalizeForecastProducts(actualProducts);
    const names = Array.from(new Set([...Object.keys(predMap), ...Object.keys(actualMap)]));
    let totalPredQty = 0;
    let totalActualQty = 0;
    let totalAbsError = 0;
    const perProduct = names.map((name) => {
      const predQty = Number(predMap[name] || 0);
      const actualQty = Number(actualMap[name] || 0);
      const absError = Math.abs(predQty - actualQty);
      const ape = absError / Math.max(actualQty, 1);
      const accuracy = Math.max(0, Math.min(1, 1 - ape));
      totalPredQty += predQty;
      totalActualQty += actualQty;
      totalAbsError += absError;
      return {
        product: name,
        predQty: Number(predQty.toFixed(2)),
        actualQty: Number(actualQty.toFixed(2)),
        absError: Number(absError.toFixed(2)),
        ape: Number(ape.toFixed(4)),
        accuracy: Number(accuracy.toFixed(4))
      };
    });

    const count = perProduct.length;
    const mape = count ? Number((perProduct.reduce((s, x) => s + Number(x.ape || 0), 0) / count).toFixed(4)) : 1;
    const hitRate20 = count
      ? Number((perProduct.filter((x) => Number(x.ape || 0) <= 0.2).length / count).toFixed(4))
      : 0;
    const totalAccuracy = Number(Math.max(0, Math.min(1, 1 - (totalAbsError / Math.max(totalActualQty, 1)))).toFixed(4));
    const topDiffProducts = perProduct
      .slice()
      .sort((a, b) => Number(b.absError || 0) - Number(a.absError || 0))
      .slice(0, 10);
    return {
      totalPredQty: Number(totalPredQty.toFixed(2)),
      totalActualQty: Number(totalActualQty.toFixed(2)),
      totalAbsError: Number(totalAbsError.toFixed(2)),
      totalAccuracy,
      mape,
      hitRate20,
      productCount: count,
      perProduct,
      topDiffProducts
    };
  }

  function buildForecastCalibrationFactors(evaluations, asOfDate) {
    const list = Array.isArray(evaluations) ? evaluations : [];
    const productRatios = new Map();
    let sumPred = 0;
    let sumActual = 0;
    let sampleCount = 0;
    const cutoff = (() => {
      const d = String(asOfDate || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
    })();

    list.forEach((ev) => {
      const d = String(ev?.date || '').trim();
      if (cutoff && d && d >= cutoff) return;
      const per = Array.isArray(ev?.perProduct) ? ev.perProduct : [];
      per.forEach((x) => {
        const predQty = Number(x?.predQty || 0);
        const actualQty = Number(x?.actualQty || 0);
        if (!(predQty > 0) || !(actualQty >= 0)) return;
        const ratio = Math.max(0.2, Math.min(3, actualQty / Math.max(predQty, 0.0001)));
        const name = String(x?.product || '').trim();
        if (!name) return;
        const prev = productRatios.get(name) || [];
        prev.push(ratio);
        productRatios.set(name, prev.slice(-20));
        sumPred += predQty;
        sumActual += actualQty;
        sampleCount += 1;
      });
    });

    const globalRaw = sumPred > 0 ? (sumActual / sumPred) : 1;
    const globalFactor = Number(Math.max(0.65, Math.min(1.35, globalRaw)).toFixed(4));
    const byProduct = {};
    productRatios.forEach((ratios, name) => {
      if (!Array.isArray(ratios) || ratios.length < 2) return;
      const avg = ratios.reduce((s, x) => s + Number(x || 0), 0) / Math.max(1, ratios.length);
      byProduct[name] = Number(Math.max(0.6, Math.min(1.45, avg)).toFixed(4));
    });

    return {
      globalFactor,
      byProduct,
      sampleCount,
      productSampleCount: Object.keys(byProduct).length
    };
  }

  function applyForecastCalibration(predictions, calibration) {
    const list = normalizePredictionItems(predictions);
    const cal = calibration && typeof calibration === 'object' ? calibration : {};
    const globalFactor = Number.isFinite(Number(cal.globalFactor)) ? Number(cal.globalFactor) : 1;
    const byProduct = cal.byProduct && typeof cal.byProduct === 'object' ? cal.byProduct : {};
    return list
      .map((x) => {
        const f = Number.isFinite(Number(byProduct[x.product])) ? Number(byProduct[x.product]) : globalFactor;
        return {
          ...x,
          qty: Number((Number(x.qty || 0) * Math.max(0.5, Math.min(1.8, f))).toFixed(2))
        };
      })
      .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0));
  }

  function summarizeForecastAccuracyRows(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return {
        comparedCount: 0,
        avgAccuracy: 0,
        avgMape: 0,
        avgHitRate20: 0,
        totalPredQty: 0,
        totalActualQty: 0,
        totalAbsError: 0,
        moduleStats: []
      };
    }
    let sumAcc = 0;
    let sumMape = 0;
    let sumHit = 0;
    let totalPredQty = 0;
    let totalActualQty = 0;
    let totalAbsError = 0;
    const moduleMap = new Map();

    list.forEach((x) => {
      const acc = Number(x?.totalAccuracy || 0);
      const mape = Number(x?.mape || 0);
      const hit = Number(x?.hitRate20 || 0);
      sumAcc += acc;
      sumMape += mape;
      sumHit += hit;
      totalPredQty += Number(x?.totalPredQty || 0);
      totalActualQty += Number(x?.totalActualQty || 0);
      totalAbsError += Number(x?.totalAbsError || 0);
      const key = `${String(x?.bizType || '').trim()}||${String(x?.slot || '').trim()}`;
      const prev = moduleMap.get(key) || {
        bizType: String(x?.bizType || '').trim(),
        slot: String(x?.slot || '').trim(),
        comparedCount: 0,
        sumAcc: 0,
        sumMape: 0,
        sumHit: 0
      };
      prev.comparedCount += 1;
      prev.sumAcc += acc;
      prev.sumMape += mape;
      prev.sumHit += hit;
      moduleMap.set(key, prev);
    });

    const count = list.length;
    const moduleStats = Array.from(moduleMap.values())
      .map((m) => ({
        bizType: m.bizType,
        slot: m.slot,
        comparedCount: m.comparedCount,
        avgAccuracy: Number((m.sumAcc / Math.max(1, m.comparedCount)).toFixed(4)),
        avgMape: Number((m.sumMape / Math.max(1, m.comparedCount)).toFixed(4)),
        avgHitRate20: Number((m.sumHit / Math.max(1, m.comparedCount)).toFixed(4))
      }))
      .sort((a, b) => String(a.bizType).localeCompare(String(b.bizType)) || String(a.slot).localeCompare(String(b.slot)));

    return {
      comparedCount: count,
      avgAccuracy: Number((sumAcc / Math.max(1, count)).toFixed(4)),
      avgMape: Number((sumMape / Math.max(1, count)).toFixed(4)),
      avgHitRate20: Number((sumHit / Math.max(1, count)).toFixed(4)),
      totalPredQty: Number(totalPredQty.toFixed(2)),
      totalActualQty: Number(totalActualQty.toFixed(2)),
      totalAbsError: Number(totalAbsError.toFixed(2)),
      moduleStats
    };
  }
  return {
    normalizePredictionItems,
    forecastPredictionToProductMap,
    calcForecastAccuracyMetrics,
    buildForecastCalibrationFactors,
    applyForecastCalibration,
    summarizeForecastAccuracyRows,
  };
}
