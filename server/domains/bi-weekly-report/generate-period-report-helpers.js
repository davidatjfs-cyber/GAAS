/**
 * P4 peel: generatePeriodReport orchestration helpers.
 */

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function resolvePeriodHasTakeaway(store, storeKey, deps) {
  const {
    resolveTenantIdDefault,
    getStoreHasTakeawaySync,
    STORE_NO_TAKEAWAY,
  } = deps;
  const tid = resolveTenantIdDefault();
  const dbHasTakeaway = getStoreHasTakeawaySync(store, tid) ?? getStoreHasTakeawaySync(storeKey, tid);
  return dbHasTakeaway !== null
    ? dbHasTakeaway
    : (!STORE_NO_TAKEAWAY.has(store) && !STORE_NO_TAKEAWAY.has(storeKey));
}

export async function fetchPeriodDataQualityRange(pool, storeKey, startDate, endDate, p) {
  const rangeQ = await pool.query(`
    SELECT MIN(date)::text AS actual_start, MAX(date)::text AS actual_end,
      COUNT(DISTINCT date) AS data_days,
      COUNT(*) AS total_rows,
      COUNT(CASE WHEN COALESCE(revenue,0)=0 AND COALESCE(sales_amount,0)>0 THEN 1 END) AS missing_revenue_rows,
      COUNT(CASE WHEN COALESCE(sales_amount,0)>0 THEN 1 END) AS valid_sales_rows
    FROM pos_sales_detail WHERE TRIM(store)=TRIM($1) AND date BETWEEN $2 AND $3`, p);
  const rng = rangeQ.rows[0] || {};
  const missingRevRows = Number(rng.missing_revenue_rows || 0);
  const validSalesRows = Number(rng.valid_sales_rows || 0);
  const missingRevPct = validSalesRows > 0 ? (missingRevRows / validSalesRows * 100) : 0;
  const warnings = [];
  if (missingRevPct > 10) {
    warnings.push(`${missingRevRows}/${validSalesRows} 行(${missingRevPct.toFixed(0)}%)的实收(revenue)为0，可能影响实收营业额和实收毛利率的准确性。请检查数据导入是否完整。`);
  }
  return {
    rng,
    actualDateRange: {
      start: rng.actual_start || startDate,
      end: rng.actual_end || endDate,
      dataDays: Number(rng.data_days || 0),
    },
    dataQualityWarnings: warnings,
  };
}

export async function fetchPeriodFallbackDaily(pool, store, storeKey, startDate, endDate, deps) {
  const { dailyReportIlikePatterns, daysBetweenInclusive, shiftRangeBackward, wow } = deps;
  try {
    const drPats = [...new Set([
      ...dailyReportIlikePatterns(store),
      ...dailyReportIlikePatterns(storeKey),
      `%${String(storeKey).replace(/%/g, '')}%`
    ])].filter((x) => x && String(x).length > 1);
    const drCurr = await pool.query(
      `SELECT COUNT(DISTINCT date)::int AS dr_days,
              COALESCE(SUM(actual_revenue), 0)::numeric AS revenue,
              COALESCE(SUM(dine_orders), 0)::numeric AS orders
       FROM daily_reports
       WHERE date BETWEEN $1 AND $2
         AND (TRIM(store) = $3 OR TRIM(store) ILIKE ANY($4::text[]))`,
      [startDate, endDate, storeKey, drPats.length ? drPats : [`%${storeKey}%`]]
    );
    const periodDays = daysBetweenInclusive(startDate, endDate);
    const prev = shiftRangeBackward(startDate, endDate, periodDays);
    const drPrev = await pool.query(
      `SELECT COALESCE(SUM(actual_revenue), 0)::numeric AS revenue,
              COALESCE(SUM(dine_orders), 0)::numeric AS orders
       FROM daily_reports
       WHERE date BETWEEN $1 AND $2
         AND (TRIM(store) = $3 OR TRIM(store) ILIKE ANY($4::text[]))`,
      [prev.start, prev.end, storeKey, drPats.length ? drPats : [`%${storeKey}%`]]
    );
    const c = drCurr.rows?.[0] || {};
    const pr = drPrev.rows?.[0] || {};
    const curRev = toNum(c.revenue);
    const curOrd = toNum(c.orders);
    const prevRev = toNum(pr.revenue);
    const prevOrd = toNum(pr.orders);
    return {
      current: { days: Number(c.dr_days || 0), revenue: curRev, orders: curOrd },
      previous: { revenue: prevRev, orders: prevOrd },
      revenueWowPct: wow(curRev, prevRev),
      ordersWowPct: wow(curOrd, prevOrd),
    };
  } catch (_e) {
    return null;
  }
}

export function applyPeriodAlignmentWarnings(report, align, rng, storeKey) {
  if (align.note) {
    report.dataQualityWarnings = report.dataQualityWarnings || [];
    report.dataQualityWarnings.unshift(align.note);
  }
  if (Number(rng.data_days || 0) === 0) {
    report.dataQualityWarnings = report.dataQualityWarnings || [];
    report.dataQualityWarnings.push(
      `**【需确认】** 统计周期内 pos_sales_detail **零行**。若你已在其它系统上传销售，请核对「门店」字段是否与库中一致（当前用于查询：**${storeKey}**）。`
    );
  }
}

export async function fetchPeriodPosAnalytics(pool, p, deps) {
  const { shouldExcludeDish, BIZ_TYPES } = deps;

  const dur = await pool.query(`
    SELECT slot,
      ROUND(AVG(EXTRACT(EPOCH FROM (checkout_time - order_time))/60)::numeric, 1) as avg_min,
      COUNT(*) as cnt
    FROM pos_sales_detail
    WHERE TRIM(store)=TRIM($1) AND date BETWEEN $2 AND $3
      AND biz_type='dinein' AND order_time IS NOT NULL AND checkout_time IS NOT NULL
      AND checkout_time > order_time
    GROUP BY slot ORDER BY slot`, p);

  const rankingRaw = await pool.query(`
    SELECT biz_type, dish_name, SUM(qty) as total_qty, SUM(sales_amount) as total_sales
    FROM pos_sales_detail
    WHERE TRIM(store)=TRIM($1) AND date BETWEEN $2 AND $3
      AND biz_type IN ('dinein','takeaway')
      AND dish_name IS NOT NULL
    GROUP BY biz_type, dish_name
    HAVING SUM(qty) > 0 AND SUM(sales_amount) > 0
  `, p);
  const rankingByBiz = { dinein: [], takeaway: [] };
  for (const row of rankingRaw.rows || []) {
    const biz = String(row.biz_type || '').trim();
    if (!rankingByBiz[biz]) continue;
    if (shouldExcludeDish(row.dish_name)) continue;
    rankingByBiz[biz].push({
      dish_name: row.dish_name,
      total_qty: toNum(row.total_qty),
      total_sales: toNum(row.total_sales)
    });
  }
  const rankingSections = {};
  for (const biz of BIZ_TYPES) {
    const list = (rankingByBiz[biz] || []).sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0));
    rankingSections[`ranking_${biz}`] = {
      top10: list.slice(0, 10),
      bottom10: [...list].sort((a, b) => Number(a.total_sales || 0) - Number(b.total_sales || 0)).slice(0, 10)
    };
  }

  const wk = await pool.query(`
    SELECT weekday, biz_type,
      COUNT(DISTINCT order_time) as order_cnt,
      SUM(sales_amount) as total_sales
    FROM pos_sales_detail
    WHERE TRIM(store)=TRIM($1) AND date BETWEEN $2 AND $3
    GROUP BY weekday, biz_type ORDER BY weekday`, p);

  const hr = await pool.query(`
    SELECT weekday, EXTRACT(HOUR FROM order_time)::int as hour, biz_type, COUNT(*) as cnt
    FROM pos_sales_detail
    WHERE TRIM(store)=TRIM($1) AND date BETWEEN $2 AND $3 AND order_time IS NOT NULL
    GROUP BY weekday, hour, biz_type ORDER BY weekday, hour`, p);

  return {
    diningDuration: dur.rows,
    rankingSections,
    weekdayRatios: wk.rows,
    hourlyOrders: hr.rows,
  };
}

export async function fetchPeriodMarginSections(storeKey, startDate, endDate, deps) {
  const {
    queryMarginByBiz,
    querySalesRawTotals,
    querySalesRawTotalsBySlot,
    queryMarginBySlot,
    queryCostCoverageDiagnostics,
    querySalesRawTotalsDinein,
    querySalesRawTotalsTakeaway,
  } = deps;

  const [
    currentMargin,
    salesRawTotals,
    slotRawTotals,
    slotMargins,
    costCov,
    dineinRawTotals,
    takeawayRawTotals
  ] = await Promise.all([
    queryMarginByBiz(storeKey, startDate, endDate),
    querySalesRawTotals(storeKey, startDate, endDate),
    querySalesRawTotalsBySlot(storeKey, startDate, endDate),
    queryMarginBySlot(storeKey, startDate, endDate),
    queryCostCoverageDiagnostics(storeKey, startDate, endDate, 15),
    querySalesRawTotalsDinein(storeKey, startDate, endDate),
    querySalesRawTotalsTakeaway(storeKey, startDate, endDate)
  ]);

  return {
    salesRawTotals,
    dineinRawTotals,
    takeawayRawTotals,
    slotRawTotals,
    theoreticalMargins: {
      ...currentMargin.margins,
      totals: {
        total: currentMargin.total,
        dinein: currentMargin.byBiz.dinein,
        takeaway: currentMargin.byBiz.takeaway
      }
    },
    slotMargins,
    costCoverage: costCov,
    currentMargin,
    dineinRawTotalsForWow: dineinRawTotals,
  };
}

export function appendCostCoverageWarnings(report, costCov, hasTakeaway, deps) {
  const { COST_COVERAGE_WARN_THRESHOLD_PCT } = deps;
  const takeCoverage = toNum(costCov?.byBiz?.takeaway?.salesCoveragePct);
  const dineinCoverage = toNum(costCov?.byBiz?.dinein?.salesCoveragePct);
  if (hasTakeaway && takeCoverage > 0 && takeCoverage < COST_COVERAGE_WARN_THRESHOLD_PCT) {
    report.dataQualityWarnings.push(`外卖成本覆盖率仅 ${takeCoverage.toFixed(1)}%，低于${COST_COVERAGE_WARN_THRESHOLD_PCT}%门槛，本期外卖毛利可信度较低。请先补齐成本库/别名映射后再解读毛利。`);
  }
  if (dineinCoverage > 0 && dineinCoverage < COST_COVERAGE_WARN_THRESHOLD_PCT) {
    report.dataQualityWarnings.push(`堂食成本覆盖率仅 ${dineinCoverage.toFixed(1)}%，低于${COST_COVERAGE_WARN_THRESHOLD_PCT}%门槛，本期堂食毛利可信度较低。`);
  }
}

export async function fetchPeriodWowSection(report, storeKey, startDate, endDate, marginBundle, deps) {
  const {
    daysBetweenInclusive,
    shiftRangeBackward,
    queryMarginByBiz,
    querySalesRawTotals,
    querySalesRawTotalsDinein,
    wow,
  } = deps;
  const {
    salesRawTotals,
    dineinRawTotalsForWow: dineinRawTotals,
    currentMargin,
  } = marginBundle;

  const periodDays = daysBetweenInclusive(startDate, endDate);
  const prev = shiftRangeBackward(startDate, endDate, periodDays);
  const [previousMargin, previousRaw, previousDinein] = await Promise.all([
    queryMarginByBiz(storeKey, prev.start, prev.end),
    querySalesRawTotals(storeKey, prev.start, prev.end),
    querySalesRawTotalsDinein(storeKey, prev.start, prev.end)
  ]);
  const fbWow = report.sections.fallbackDaily;
  const useDailyRev = fbWow?.current && Number(fbWow.current.days) > 0;
  const netCurr = useDailyRev ? toNum(fbWow.current.revenue) : salesRawTotals.net;
  const netPrev = useDailyRev ? toNum(fbWow.previous.revenue) : previousRaw.net;
  const discCurr = Math.max(0, dineinRawTotals.gross - netCurr);
  const discPrev = Math.max(0, previousDinein.gross - netPrev);
  return {
    currentRange: { start: startDate, end: endDate },
    previousRange: prev,
    salesWowPct: wow(dineinRawTotals.gross, previousDinein.gross),
    revenueWowPct: wow(netCurr, netPrev),
    discountWowPct: wow(discCurr, discPrev),
    netMarginWowPct: wow(
      currentMargin.margins.totalNetMarginPct ?? NaN,
      previousMargin.margins.totalNetMarginPct ?? NaN
    ),
    headlineUsesDailyRevenue: !!useDailyRev
  };
}

export async function runGeneratePeriodReport(deps, store, startDate, endDate, reportType = 'weekly') {
  const { pool, resolveStoreKeyForReports, buildAnalysisSummary } = deps;
  const align = await resolveStoreKeyForReports(store);
  const storeKey = String(align.useStore || store).trim() || String(store).trim();
  const p = [storeKey, startDate, endDate];
  const report = {
    store,
    storeDbKey: storeKey,
    storeAlignment: align,
    weekStart: startDate,
    weekEnd: endDate,
    reportType,
    sections: {}
  };
  report.hasTakeaway = resolvePeriodHasTakeaway(store, storeKey, deps);

  const { rng, actualDateRange, dataQualityWarnings } = await fetchPeriodDataQualityRange(pool, storeKey, startDate, endDate, p);
  report.actualDateRange = actualDateRange;
  report.dataQualityWarnings = dataQualityWarnings;

  report.sections.fallbackDaily = await fetchPeriodFallbackDaily(pool, store, storeKey, startDate, endDate, deps);
  applyPeriodAlignmentWarnings(report, align, rng, storeKey);

  const posAnalytics = await fetchPeriodPosAnalytics(pool, p, deps);
  report.sections.diningDuration = posAnalytics.diningDuration;
  Object.assign(report.sections, posAnalytics.rankingSections);
  report.sections.weekdayRatios = posAnalytics.weekdayRatios;
  report.sections.hourlyOrders = posAnalytics.hourlyOrders;

  const marginBundle = await fetchPeriodMarginSections(storeKey, startDate, endDate, deps);
  report.sections.salesRawTotals = marginBundle.salesRawTotals;
  report.sections.dineinRawTotals = marginBundle.dineinRawTotals;
  report.sections.takeawayRawTotals = marginBundle.takeawayRawTotals;
  report.sections.slotRawTotals = marginBundle.slotRawTotals;
  report.sections.theoreticalMargins = marginBundle.theoreticalMargins;
  report.sections.slotMargins = marginBundle.slotMargins;
  report.sections.costCoverage = marginBundle.costCoverage;
  appendCostCoverageWarnings(report, marginBundle.costCoverage, report.hasTakeaway, deps);

  report.sections.wow = await fetchPeriodWowSection(report, storeKey, startDate, endDate, marginBundle, deps);
  report.sections.analysisSummary = buildAnalysisSummary(report);

  return report;
}
