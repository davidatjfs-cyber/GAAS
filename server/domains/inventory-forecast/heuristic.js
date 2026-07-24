import { normalizeForecastWeatherTag } from './product-normalize.js';
import { normalizeForecastBizType, normalizeForecastSlot } from './normalize.js';

export const FORECAST_EXCLUDED_PRODUCTS = ['打包盒', '特色米饭', '年夜饭', '五常大米饭'];

export function isExcludedForecastProduct(name) {
    const n = String(name || '').trim();
    if (!n) return true;
    return FORECAST_EXCLUDED_PRODUCTS.some((kw) => n.includes(kw));
}

export function createNormalizeForecastProducts({ safeNumber }) {
  function normalizeForecastProducts(input) {
    const out = {};
    if (Array.isArray(input)) {
      input.forEach((it) => {
        const name = String(it?.name || it?.product || '').trim();
        if (isExcludedForecastProduct(name)) return;
        if (!name) return;
        const qty = safeNumber(it?.qty ?? it?.quantity ?? it?.count);
        if (!Number.isFinite(qty) || qty < 0) return;
        out[name] = Number((Number(out[name] || 0) + qty).toFixed(2));
      });
      return out;
    }
    if (input && typeof input === 'object') {
      Object.keys(input).forEach((k) => {
        const name = String(k || '').trim();
        if (isExcludedForecastProduct(name)) return;
        if (!name) return;
        const qty = safeNumber(input[k]);
        if (!Number.isFinite(qty) || qty < 0) return;
        out[name] = Number(qty.toFixed(2));
      });
    }
    return out;
  }
  return normalizeForecastProducts;
}

export function scoreForecastRow(item, target) {
    const date = String(item?.date || '').trim();
    const weather = String(item?.weather || '').trim().toLowerCase();
    const targetWeather = String(target?.weather || '').trim().toLowerCase();
    let score = 1;
    let dayDiff = null;
    try {
      const d1 = new Date(date + 'T00:00:00');
      const d2 = new Date(String(target?.date || '') + 'T00:00:00');
      if (Number.isFinite(d1.getTime()) && Number.isFinite(d2.getTime())) {
        dayDiff = Math.abs(Math.round((d2.getTime() - d1.getTime()) / 86400000));
        // Day-of-week: exact match is the strongest signal (Mon≠Fri≠Sat)
        if (d1.getDay() === d2.getDay()) score += 1.8;
        else {
          const diff = Math.abs(d1.getDay() - d2.getDay());
          const adj = Math.min(diff, 7 - diff);
          if (adj === 1) score += 0.3;
        }
        // Recency bonus: closer dates are more reliable for food demand.
        const recencyBonus = Math.max(0, 1.0 - Math.min(1.0, Number(dayDiff || 0) / 60));
        score += recencyBonus;
      }
    } catch (e) { /* ignore */ }
    // Holiday matching as separate dimension (some stores busy on holidays, some not)
    if (Boolean(item?.isHoliday) === Boolean(target?.isHoliday)) score += 0.7;
    // Weather match
    const itemWeatherTag = normalizeForecastWeatherTag(weather);
    const targetWeatherTag = normalizeForecastWeatherTag(targetWeather);
    if (itemWeatherTag && targetWeatherTag) {
      if (itemWeatherTag === targetWeatherTag) score += 0.6;
      else score += 0.1;
    }
    const rev = Number(item?.expectedRevenue || 0);
    const targetRev = Number(target?.expectedRevenue || 0);
    if (targetRev > 0 && rev > 0) {
      const diffRate = Math.abs(rev - targetRev) / Math.max(targetRev, 1);
      score += Math.max(0, 0.8 - diffRate);
    }
    return Math.max(0.2, Number(score.toFixed(4)));
}

export function buildForecastByHeuristic(historyRows, target, topN) {
    const list = Array.isArray(historyRows) ? historyRows : [];
    if (!list.length) return { predictions: [], confidence: 0.1, summary: '暂无历史数据，无法生成稳定预测。' };

    const sumByProduct = new Map();
    let totalScore = 0;
    let strongMatchCount = 0;
    let weightedRevenueSum = 0;
    let revenueScoreSum = 0;

    list.forEach((row) => {
      const score = scoreForecastRow(row, target);
      totalScore += score;
      if (score >= 2.4) strongMatchCount += 1;
      const rowRev = Number(row?.expectedRevenue || row?.revenue || row?.totalAmount || 0);
      if (rowRev > 0) {
        weightedRevenueSum += rowRev * score;
        revenueScoreSum += score;
      }
      const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
      Object.entries(products).forEach(([name, qtyRaw]) => {
        const nameSafe = String(name || '').trim();
        if (isExcludedForecastProduct(nameSafe)) return;
        if (!nameSafe) return;
        const qty = Number(qtyRaw || 0);
        if (!Number.isFinite(qty) || qty < 0) return;
        const prev = sumByProduct.get(nameSafe) || 0;
        sumByProduct.set(nameSafe, prev + qty * score);
      });
    });

    const divider = totalScore > 0 ? totalScore : list.length;

    // CRITICAL: Calculate revenue scaling factor
    // If target revenue is 20000 but historical average is 10000, scale predictions by ~2x
    const targetRev = Number(target?.expectedRevenue || 0);
    const avgHistoricalRevenue = revenueScoreSum > 0 ? (weightedRevenueSum / revenueScoreSum) : 0;
    let revenueScale = 1;
    if (targetRev > 0 && avgHistoricalRevenue > 0) {
      const ratio = targetRev / avgHistoricalRevenue;
      // Small sample size is very noisy. Use stronger damping to avoid runaway qty inflation.
      const exp = list.length < 8 ? 0.45 : (list.length < 20 ? 0.6 : 0.72);
      revenueScale = Math.pow(Math.max(0.01, ratio), exp);
      // 旺日/节假日放宽缩放上限，避免大促当天备货系统性不足；样本越多越敢放宽。
      const upperCap = target?.isHoliday ? 2.8 : (list.length >= 20 ? 2.3 : 1.9);
      if (revenueScale > upperCap) revenueScale = upperCap;
      if (revenueScale < 0.6) revenueScale = 0.6;
    }

    const sorted = Array.from(sumByProduct.entries())
      .map(([product, weightedQty]) => ({
        product,
        qty: Number(((weightedQty / Math.max(1, divider)) * revenueScale).toFixed(1)),
        reason: revenueScale !== 1 ? `营收比例${(revenueScale * 100).toFixed(0)}%调整` : ''
      }))
      .filter((x) => Number(x.qty) > 0)
      .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0));

    const limit = Math.max(5, Math.min(80, Number(topN || 20) || 20));
    const predictions = sorted.slice(0, limit);
    const baseConfidence = 0.35 + Math.min(0.35, list.length * 0.015) + Math.min(0.2, strongMatchCount * 0.03);
    const confidence = Number(Math.max(0.1, Math.min(0.95, baseConfidence)).toFixed(2));
    const revNote = (targetRev > 0 && avgHistoricalRevenue > 0)
      ? `预计营收¥${targetRev}（历史均值¥${Math.round(avgHistoricalRevenue)}，缩放${(revenueScale * 100).toFixed(0)}%）。`
      : '';
    const summary = `基于${list.length}条历史记录进行相似度加权，匹配度较高样本${strongMatchCount}条。${revNote}`;
    return { predictions, confidence, summary };
}

export function extractHistoryProductUniverse(historyRows) {
    const out = new Set();
    (Array.isArray(historyRows) ? historyRows : []).forEach((row) => {
      const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
      Object.keys(products).forEach((name) => {
        const n = String(name || '').trim();
        if (!n || isExcludedForecastProduct(n)) return;
        out.add(n);
      });
    });
    return out;
}

export function createConstrainPredictionsToHistory({ normalizePredictionItems }) {
  function constrainPredictionsToHistory(predictions, historyRows, topN) {
    const universe = extractHistoryProductUniverse(historyRows);
    if (!universe.size) return [];
    return normalizePredictionItems(predictions)
      .filter((x) => universe.has(String(x?.product || '').trim()))
      .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
      .slice(0, Math.max(5, Math.min(80, Number(topN || 20) || 20)));
  }
  return constrainPredictionsToHistory;
}

export function createComputeSlotRevenueShare({ safeDateOnly }) {
  // Compute slot's share of total biz-type revenue from historical data.
  // Returns { slotRevenue, slotShare, splitMode } where slotRevenue is the
  // revenue this specific slot should expect given a total biz-type revenue.
  function computeSlotRevenueShare(allHistoryRows, store, bizType, slot, date) {
    const rows = (Array.isArray(allHistoryRows) ? allHistoryRows : [])
      .filter((x) => String(x?.store || '').trim() === String(store || '').trim())
      .filter((x) => normalizeForecastBizType(x?.bizType) === normalizeForecastBizType(bizType))
      .filter((x) => { const d = safeDateOnly(x?.date); return !date || !d || d <= date; });
    const bySlot = { lunch: 0, afternoon: 0, dinner: 0 };
    rows.forEach((row) => {
      const s = normalizeForecastSlot(row?.slot);
      if (s && Object.prototype.hasOwnProperty.call(bySlot, s)) {
        bySlot[s] += Math.max(0, Number(row?.expectedRevenue || 0));
      }
    });
    const total = Object.values(bySlot).reduce((a, b) => a + b, 0);
    // Fallback shares if no history: typical restaurant pattern
    const fallback = { lunch: 0.45, afternoon: 0.10, dinner: 0.45 };
    const normalizedSlot = normalizeForecastSlot(slot);
    if (total > 0) {
      const share = Number((bySlot[normalizedSlot] || 0) / total);
      return { slotShare: Number(Math.max(0.05, share).toFixed(4)), splitMode: 'history' };
    }
    return { slotShare: fallback[normalizedSlot] || 0.33, splitMode: 'fallback' };
  }
  return computeSlotRevenueShare;
}
