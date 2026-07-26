export function estimateRevenueByHistory(deps, historyRows, target, store) {
  const rows = Array.isArray(historyRows) ? historyRows : [];
  const dailyMap = new Map();
  rows.forEach((row) => {
    const date = deps.safeDateOnly(row?.date);
    const bizType = deps.normalizeForecastBizType(row?.bizType);
    if (!date || !bizType) return;
    const key = `${date}||${bizType}`;
    const prev = dailyMap.get(key) || {
      date,
      bizType,
      weather: deps.normalizeForecastWeather(row?.weather),
      isHoliday: !!row?.isHoliday,
      revenue: 0
    };
    prev.revenue += Number(row?.expectedRevenue || 0);
    if (!prev.weather) prev.weather = deps.normalizeForecastWeather(row?.weather);
    if (row?.isHoliday) prev.isHoliday = true;
    dailyMap.set(key, prev);
  });

  // Mark known public holidays so they get the same penalty as CNY weekdays
  dailyMap.forEach((item) => {
    if (!item.isHoliday && deps.isKnownPublicHoliday(item.date)) item.isHoliday = true;
  });

  // Outlier removal: per-DOW IQR filter.
  // Removes extreme records (e.g. Jan 15 = 502722) that would skew the weighted average.
  // Only removes genuine outliers: revenue > Q3 + 3×IQR within the same day-of-week group.
  (() => {
    const revByDow = {};
    dailyMap.forEach((item) => {
      const dObj = new Date(String(item.date || '') + 'T00:00:00');
      if (!Number.isFinite(dObj.getTime())) return;
      const dw = dObj.getDay();
      if (!revByDow[dw]) revByDow[dw] = [];
      revByDow[dw].push(Number(item.revenue || 0));
    });
    const caps = {};
    Object.entries(revByDow).forEach(([dw, vals]) => {
      if (vals.length < 4) return;
      const sorted = vals.slice().sort((a, b) => a - b);
      const q1 = sorted[Math.floor(sorted.length * 0.25)];
      const q3 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = q3 - q1;
      caps[dw] = q3 + 3 * iqr;
    });
    dailyMap.forEach((item, key) => {
      const dObj = new Date(String(item.date || '') + 'T00:00:00');
      if (!Number.isFinite(dObj.getTime())) return;
      const dw = dObj.getDay();
      const cap = caps[dw];
      if (cap != null && Number(item.revenue || 0) > cap) {
        dailyMap.delete(key);
      }
    });
  })();

  const storeConfig = deps.getStoreForecastConfig(store);
  const targetDate = deps.safeDateOnly(target?.date);
  const targetWeatherTag = deps.normalizeForecastWeatherTag(target?.weather);
  const targetIsHoliday = !!target?.isHoliday;
  let targetDow = -1;
  try {
    const td = new Date(String(targetDate || '') + 'T00:00:00');
    if (Number.isFinite(td.getTime())) targetDow = td.getDay();
    // 节假日按周末预测：将目标日视为周日(0)
    if (storeConfig.holidayAsWeekend && targetIsHoliday && targetDow >= 1 && targetDow <= 5) targetDow = 0;
  } catch (e) { /* ignore */ }

  const result = {
    sampleCount: 0,
    byBizType: {
      takeaway: { enabled: false, estimatedRevenue: 0, sampleCount: 0, confidence: 0 },
      dinein: { enabled: false, estimatedRevenue: 0, sampleCount: 0, confidence: 0 }
    },
    totalEstimatedRevenue: 0
  };

  ['takeaway', 'dinein'].forEach((bizType) => {
    const list = Array.from(dailyMap.values())
      .filter((x) => x.bizType === bizType)
      .filter((x) => Number(x.revenue || 0) > 0)
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 400);
    result.byBizType[bizType].enabled = list.length > 0;
    result.byBizType[bizType].sampleCount = list.length;
    result.sampleCount += list.length;
    if (!list.length) return;

    // Determine if target is a normal workday (non-holiday, non-CNY, Mon-Fri)
    const targetIsNormalWorkday = deps.isNormalWorkday(targetDate, targetIsHoliday);

    const scored = list.map((item) => {
      let score = 1;
      let cnyPenaltyFactor = 1.0; // applied last, after all additive scoring
      try {
        const d1 = new Date(String(item.date || '') + 'T00:00:00');
        if (Number.isFinite(d1.getTime()) && targetDow >= 0) {
          // Day-of-week: exact match is the strongest signal (Mon≠Fri, weekday≠weekend)
          let itemDow = d1.getDay();
          const itemRawDow = itemDow;
          if (storeConfig.holidayAsWeekend && item.isHoliday && itemDow >= 1 && itemDow <= 5) itemDow = 0;
          if (itemDow === targetDow) score += 20.0;
          else {
            // Saturday(6) and Sunday(0) are NOT interchangeable — different revenue patterns
            const bothWeekend = (itemDow === 0 || itemDow === 6) && (targetDow === 0 || targetDow === 6);
            if (bothWeekend) score += 1.5;
            else score += 0.3; // weekday vs wrong weekday, or weekday vs weekend
          }

          // ── CNY / holiday contamination detection ─────────────────────────
          const itemIsCNY = deps.isCNYPeriod(item.date);
          const itemIsHolidayWeekday = (item.isHoliday || itemIsCNY) && itemRawDow >= 1 && itemRawDow <= 5;
          const itemIsNormalWkd = deps.isNormalWorkday(item.date, item.isHoliday);

          if (itemIsHolidayWeekday && targetIsNormalWorkday) {
            // CNY-inflated weekday vs normal-day target: nearly discard
            // Penalty applied AFTER all additive scoring so recency can't rescue it
            cnyPenaltyFactor = 0.05;
          } else if (itemIsNormalWkd && !targetIsNormalWorkday && (targetDow === 0 || targetDow === 6 || targetIsHoliday)) {
            // Normal weekday data pulled for weekend/holiday forecast: down-weight
            cnyPenaltyFactor = 0.5;
          }

          // Recency bonus: skip for CNY-contaminated items targeting normal workdays
          if (targetDate && cnyPenaltyFactor > 0.1) {
            const d2 = new Date(targetDate + 'T00:00:00');
            if (Number.isFinite(d2.getTime())) {
              const dayDiff = Math.abs(Math.round((d2.getTime() - d1.getTime()) / 86400000));
              score += Math.max(0, 2.0 * (1.0 - Math.min(1.0, dayDiff / 90)));
            }
          }
        } else if (targetDate) {
          // Recency bonus when DOW not available
          const d1b = new Date(String(item.date || '') + 'T00:00:00');
          const d2 = new Date(targetDate + 'T00:00:00');
          if (Number.isFinite(d1b.getTime()) && Number.isFinite(d2.getTime())) {
            const dayDiff = Math.abs(Math.round((d2.getTime() - d1b.getTime()) / 86400000));
            score += Math.max(0, 2.0 * (1.0 - Math.min(1.0, dayDiff / 90)));
          }
        }
      } catch (e) { /* ignore */ }
      // Holiday matching (separate dimension)
      if (Boolean(item.isHoliday) === targetIsHoliday) score += 0.8;
      // Weather match
      const itemWeatherTag = deps.normalizeForecastWeatherTag(item.weather);
      if (itemWeatherTag && targetWeatherTag) {
        if (itemWeatherTag === targetWeatherTag) score += 0.6;
        else score += 0.1;
      }
      // Apply CNY penalty as final multiplier — after all additive bonuses
      score = score * cnyPenaltyFactor;
      return { ...item, score: Number(score.toFixed(4)) };
    });

    // Filter to exact DOW-matching items when sufficient (≥2) to prevent
    // weekend high-revenue records from inflating weekday forecasts.
    const dowMatched = scored.filter((x) => {
      if (targetDow < 0) return false;
      try {
        const dw = new Date(String(x.date || '') + 'T00:00:00').getDay();
        return dw === targetDow;
      } catch (e) { return false; }
    });
    const scoringPool = dowMatched.length >= 2 ? dowMatched : scored;
    const picked = scoringPool
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, Math.min(20, scoringPool.length));
    const scoreSum = picked.reduce((s, x) => s + Number(x.score || 0), 0);
    const weightedRevenue = picked.reduce((s, x) => s + Number(x.revenue || 0) * Number(x.score || 0), 0);
    let estimatedRevenue = scoreSum > 0 ? (weightedRevenue / scoreSum) : 0;

    // Weather adjustment: rain/snow → takeaway up, dine-in down (differential correction)
    // Only apply if the weather-matched samples are underrepresented in picked set
    if (targetWeatherTag === 'rain' || targetWeatherTag === 'snow') {
      const matchCount = picked.filter((x) => deps.normalizeForecastWeatherTag(x.weather) === targetWeatherTag).length;
      const coverage = picked.length > 0 ? matchCount / picked.length : 0;
      const strength = Math.max(0, 1 - coverage * 2); // full strength if <50% weather-matched
      const wf = targetWeatherTag === 'snow' ? storeConfig.snowFactor : storeConfig.rainFactor;
      const drop = 1 - wf; // e.g. 0.10 for 90% factor
      if (bizType === 'dinein') estimatedRevenue *= (1 - drop * strength);
      else if (bizType === 'takeaway') estimatedRevenue *= (1 + drop * 0.5 * strength);
    }

    const confidence = Math.max(0.2, Math.min(0.95, 0.35 + Math.min(0.5, list.length * 0.02)));
    result.byBizType[bizType].estimatedRevenue = Number(Math.max(0, estimatedRevenue).toFixed(2));
    result.byBizType[bizType].confidence = Number(confidence.toFixed(2));
    result.totalEstimatedRevenue += Number(result.byBizType[bizType].estimatedRevenue || 0);
  });

  result.totalEstimatedRevenue = Number(result.totalEstimatedRevenue.toFixed(2));
  return result;
}

export function normalizeGrossProfitProfileItem(deps, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const product = String(raw?.product || '').trim();
  const bizType = deps.normalizeForecastBizType(raw?.bizType) || '';
  const costPerUnit = deps.safeNumber(raw?.costPerUnit ?? raw?.cost);
  const grossPerUnit = deps.safeNumber(raw?.grossPerUnit ?? raw?.grossProfit ?? raw?.profitPerUnit);
  if (!product) return null;
  // Accept either costPerUnit or grossPerUnit
  const hasCost = Number.isFinite(costPerUnit) && costPerUnit >= 0;
  const hasGross = Number.isFinite(grossPerUnit) && grossPerUnit >= 0;
  if (!hasCost && !hasGross) return null;
  return {
    product,
    bizType,
    costPerUnit: hasCost ? Number(costPerUnit.toFixed(4)) : undefined,
    grossPerUnit: hasGross ? Number(grossPerUnit.toFixed(4)) : undefined
  };
}

export function computeAvgPricePerProduct(deps, historyRows, storeScope, aliasLookup) {
  const storeSet = new Set(
    (Array.isArray(storeScope) ? storeScope : [storeScope])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
  );
  // agg keyed by bizType||productKey so dine-in and takeaway prices are tracked separately
  const agg = new Map();
  const rows = Array.isArray(historyRows) ? historyRows : [];
  rows.filter((x) => {
    if (!storeSet.size) return true;
    return storeSet.has(String(x?.store || '').trim());
  }).forEach((row) => {
    const rowBiz = deps.normalizeForecastBizType(row?.bizType) || '';
    const rev = Math.max(0, Number(row?.expectedRevenue || 0));
    const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
    const entries = Object.entries(products)
      .map(([p, q]) => ({ product: String(p || '').trim(), qty: Number(q || 0) }))
      .filter((x) => x.product && x.qty > 0);
    const totalQty = entries.reduce((s, x) => s + x.qty, 0);
    entries.forEach(({ product, qty }) => {
      const resolved = deps.resolveForecastProductName(product, aliasLookup);
      if (!resolved.key) return;
      const allocRev = totalQty > 0 && rev > 0 ? (qty / totalQty) * rev : 0;
      // Key by bizType so channels don't blend prices
      const key = `${rowBiz}||${resolved.key}`;
      const prev = agg.get(key) || { totalRevenue: 0, totalQty: 0 };
      prev.totalRevenue += allocRev;
      prev.totalQty += qty;
      agg.set(key, prev);
      // Also accumulate blended fallback key (empty biz prefix) for cross-channel lookup
      const fallbackKey = `||${resolved.key}`;
      const prev2 = agg.get(fallbackKey) || { totalRevenue: 0, totalQty: 0 };
      prev2.totalRevenue += allocRev;
      prev2.totalQty += qty;
      agg.set(fallbackKey, prev2);
    });
  });
  const result = new Map();
  agg.forEach((v, k) => {
    if (v.totalQty > 0) result.set(k, Number((v.totalRevenue / v.totalQty).toFixed(4)));
  });
  return result;
}

export function canManageGrossProfitProfiles(deps, role) {
const r = String(role || '').trim();
return r === 'admin' || r === 'hq_manager';
}

export function normalizeDishAliasBizType(deps, v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || s === '*' || s === 'all' || s === '全部' || s === '通用') return '*';
  if (/takeaway|delivery|外卖|外送/.test(s)) return 'takeaway';
  if (/dinein|堂食|店内|堂食点餐/.test(s)) return 'dinein';
  return '*';
}

export function estimateGrossMarginByHistory(deps, { historyRows, profiles, startDate, endDate, bizType, storeScope, aliasLookup }) {
const list = Array.isArray(historyRows) ? historyRows : [];
const profileList = Array.isArray(profiles) ? profiles : [];
// Build avg price map for cost→gross conversion
const priceMap = storeScope ? computeAvgPricePerProduct(list, storeScope, aliasLookup) : new Map();
const profileMap = new Map();
const costPerUnitMap = new Map();
  profileList.forEach((p) => {
    const item = normalizeGrossProfitProfileItem(p);
    if (!item) return;
    let gpu = item.grossPerUnit;
    const resolvedItem = deps.resolveForecastProductName(item.product, aliasLookup);
    const hasCost = Number.isFinite(item.costPerUnit) && item.costPerUnit >= 0;
    // Store costPerUnit for direct cost-based calculation
    if (hasCost) {
      costPerUnitMap.set(`${item.bizType}||${resolvedItem.key}`, item.costPerUnit);
      costPerUnitMap.set(`||${resolvedItem.key}`, item.costPerUnit);
    }
    // If only costPerUnit is set, compute grossPerUnit from biz-specific avg price
    if ((!Number.isFinite(gpu) || gpu === undefined) && hasCost) {
      const bizKey = `${item.bizType}||${resolvedItem.key}`;
      const fallbackKey = `||${resolvedItem.key}`;
      const avgPrice = priceMap.get(bizKey) || priceMap.get(fallbackKey) || 0;
      gpu = avgPrice > item.costPerUnit ? Number((avgPrice - item.costPerUnit).toFixed(4)) : 0;
    }
    if (!Number.isFinite(gpu)) return;
    // Store by both original and normalized name for matching
    profileMap.set(`${item.bizType}||${resolvedItem.key}`, gpu);
    const normName = resolvedItem.key;
    if (normName && normName !== item.product) {
      profileMap.set(`${item.bizType}||${normName}`, gpu);
      profileMap.set(`||${normName}`, gpu);
    }
    profileMap.set(`||${resolvedItem.key}`, gpu);
  });

  let rows = list.filter((x) => deps.inDateRange(String(x?.date || '').trim(), startDate, endDate));
  if (bizType) rows = rows.filter((x) => deps.normalizeForecastBizType(x?.bizType) === bizType);

  const productAgg = new Map();
  const byBizAgg = new Map();
  const uncovered = new Map();
  let totalRevenue = 0;
  let totalGrossProfit = 0;
  let totalActualRevenue = 0;
  let totalExpectedRevenue = 0;

  rows.forEach((row) => {
    const rowBizType = deps.normalizeForecastBizType(row?.bizType);
    const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
    let rev = Math.max(0, Number(row?.expectedRevenue || 0));
    let rowActualRevRaw = Math.max(0, Number(row?.actualRevenue || 0));
    const rowDiscount = Math.max(0, Number(row?.totalDiscount || 0));
    // 安全校验：折前营收一定>=实收营收，若反了则交换（修复列映射反转问题）
    if (rev > 0 && rowActualRevRaw > 0 && rowActualRevRaw > rev) {
      const tmp = rev; rev = rowActualRevRaw; rowActualRevRaw = tmp;
    }
    const rowActualRev = rowActualRevRaw > 0 ? rowActualRevRaw : Math.max(0, rev - rowDiscount);
    totalExpectedRevenue += rev;
    totalActualRevenue += rowActualRev;
    const validEntries = Object.entries(products)
      .map(([product, qtyRaw]) => ({ product: String(product || '').trim(), qty: Number(qtyRaw || 0) }))
      .filter((x) => x.product && !deps.isExcludedForecastProduct(x.product) && Number.isFinite(x.qty) && x.qty > 0);
    const rowTotalQty = validEntries.reduce((s, x) => s + Number(x.qty || 0), 0);
    validEntries.forEach((it) => {
      // Try exact name first, then normalized name for cross-matching (takeaway vs dine-in name variants)
      const resolved = deps.resolveForecastProductName(it.product, aliasLookup);
      const normName = resolved.key;
      const keyExact = `${rowBizType}||${normName}`;
      const keyFallback = `||${normName}`;
      const keyNormExact = `${rowBizType}||${normName}`;
      const keyNormFallback = `||${normName}`;
      const gpu = Number(
        profileMap.has(keyExact) ? profileMap.get(keyExact) :
        profileMap.has(keyFallback) ? profileMap.get(keyFallback) :
        profileMap.has(keyNormExact) ? profileMap.get(keyNormExact) :
        profileMap.has(keyNormFallback) ? profileMap.get(keyNormFallback) : NaN
      );
      const allocRevenue = rowTotalQty > 0 && rev > 0 ? (Number(it.qty || 0) / rowTotalQty) * rev : 0;
      if (!Number.isFinite(gpu) || gpu === 0) {
        // Fallback: if costPerUnit available but no avgPrice for gross, use cost-based
        const cpuKey = costPerUnitMap.has(keyExact) ? keyExact : costPerUnitMap.has(keyFallback) ? keyFallback : null;
        if (cpuKey) {
          const cpu = costPerUnitMap.get(cpuKey);
          const costEst = Number(it.qty || 0) * cpu;
          const grossEst = Math.max(0, allocRevenue - costEst);
          totalRevenue += allocRevenue;
          totalGrossProfit += grossEst;
          const p2 = productAgg.get(resolved.display) || { product: resolved.display, qty: 0, revenue: 0, grossProfit: 0 };
          p2.qty += Number(it.qty || 0); p2.revenue += allocRevenue; p2.grossProfit += grossEst;
          productAgg.set(resolved.display, p2);
          return;
        }
        const miss = uncovered.get(resolved.display) || { product: resolved.display, qty: 0 };
        miss.qty += Number(it.qty || 0);
        uncovered.set(resolved.display, miss);
        return;
      }
      const gross = Number(it.qty || 0) * gpu;
      totalRevenue += allocRevenue;
      totalGrossProfit += gross;

      const p = productAgg.get(resolved.display) || { product: resolved.display, qty: 0, revenue: 0, grossProfit: 0 };
      p.qty += Number(it.qty || 0);
      p.revenue += allocRevenue;
      p.grossProfit += gross;
      productAgg.set(resolved.display, p);

      const b = byBizAgg.get(rowBizType) || { bizType: rowBizType, revenue: 0, grossProfit: 0, marginRate: 0 };
      b.revenue += allocRevenue;
      b.grossProfit += gross;
      byBizAgg.set(rowBizType, b);
    });
  });

  const byBiz = Array.from(byBizAgg.values()).map((x) => ({
    bizType: x.bizType,
    revenue: Number(x.revenue.toFixed(2)),
    grossProfit: Number(x.grossProfit.toFixed(2)),
    marginRate: Number((x.revenue > 0 ? x.grossProfit / x.revenue : 0).toFixed(4))
  }));
  const products = Array.from(productAgg.values())
    .map((x) => ({
      product: x.product,
      qty: Number(x.qty.toFixed(2)),
      revenue: Number(x.revenue.toFixed(2)),
      grossProfit: Number(x.grossProfit.toFixed(2)),
      marginRate: Number((x.revenue > 0 ? x.grossProfit / x.revenue : 0).toFixed(4))
    }))
    .sort((a, b) => Number(b.grossProfit || 0) - Number(a.grossProfit || 0));

  // 估算成本 = 折前营收 - 毛利（毛利基于折前营收分配计算）
  const coveredCostRate = totalRevenue > 0 ? Math.max(0, 1 - totalGrossProfit / totalRevenue) : 1;
  const totalEstimatedCost = Math.max(0, totalExpectedRevenue * coveredCostRate);
  // 折前毛利率 = (折前营收 - 成本) / 折前营收
  const marginRate = totalRevenue > 0 ? Number((totalGrossProfit / totalRevenue).toFixed(4)) : 0;
  // 实收毛利率 = (实收营收 - 成本) / 实收营收（成本不变，实收更低所以实收毛利率 < 折前毛利率）
  const actualGrossProfit = Math.max(0, totalActualRevenue - totalEstimatedCost);
  const actualMarginRate = totalActualRevenue > 0 ? Number((actualGrossProfit / totalActualRevenue).toFixed(4)) : 0;

  return {
    sampleCount: rows.length,
    revenue: Number(totalExpectedRevenue.toFixed(2)),
    actualRevenue: Number(totalActualRevenue.toFixed(2)),
    grossProfit: Number(totalGrossProfit.toFixed(2)),
    marginRate,
    actualMarginRate,
    byBiz,
    products,
    uncoveredProducts: Array.from(uncovered.values())
      .map((x) => ({ product: x.product, qty: Number(Number(x.qty || 0).toFixed(2)) }))
      .sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0))
      .slice(0, 100)
  };
}

export function createEstimateHelpers(deps) {
  return {
    estimateRevenueByHistory: (...args) => estimateRevenueByHistory(deps, ...args),
    normalizeGrossProfitProfileItem: (...args) => normalizeGrossProfitProfileItem(deps, ...args),
    computeAvgPricePerProduct: (...args) => computeAvgPricePerProduct(deps, ...args),
    canManageGrossProfitProfiles: (...args) => canManageGrossProfitProfiles(deps, ...args),
    normalizeDishAliasBizType: (...args) => normalizeDishAliasBizType(deps, ...args),
    estimateGrossMarginByHistory: (...args) => estimateGrossMarginByHistory(deps, ...args),
  };
}
