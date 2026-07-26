/**
 * P4 peel: queryCostCoverageDiagnostics SQL + aggregation helpers.
 */

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(numerator, denominator) {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

export function buildCostCoverageBaseCteSql(deps) {
  const {
    BIZ_NORMALIZE_SQL,
    DISH_NAME_NORMALIZE_SQL,
    BIZ_MATCH_WHERE_SQL,
    BIZ_PRIORITY_SQL,
  } = deps;

  return `
    WITH sales AS (
      SELECT
        s.store,
        ${BIZ_NORMALIZE_SQL} AS biz_type,
        s.dish_name,
        SUM(COALESCE(s.qty, 0)) AS qty,
        SUM(COALESCE(s.sales_amount, 0)) AS sales_amount,
        SUM(COALESCE(s.revenue, 0)) AS revenue
      FROM pos_sales_detail s
      WHERE TRIM(s.store) = TRIM($1)
        AND s.date BETWEEN $2 AND $3
      GROUP BY s.store, s.biz_type, s.dish_name
    ), resolved AS (
      SELECT
        x.*,
        COALESCE(a.canonical_name, x.dish_name) AS resolved_dish_name
      FROM sales x
      LEFT JOIN LATERAL (
        SELECT da.canonical_name
        FROM dish_name_aliases da
        WHERE da.enabled = TRUE
          AND ${DISH_NAME_NORMALIZE_SQL('da.alias_name')} = ${DISH_NAME_NORMALIZE_SQL('x.dish_name')}
          AND (
            lower(regexp_replace(COALESCE(da.store, '*'), '\\s+', '', 'g')) = lower(regexp_replace(COALESCE(x.store, ''), '\\s+', '', 'g'))
            OR COALESCE(NULLIF(trim(da.store), ''), '*') = '*'
          )
          AND ${BIZ_MATCH_WHERE_SQL('da.biz_type', 'x.biz_type')}
        ORDER BY
          ${BIZ_PRIORITY_SQL('da.biz_type', 'x.biz_type')},
          CASE WHEN COALESCE(NULLIF(trim(da.store), ''), '*') = '*' THEN 2 ELSE 1 END,
          da.updated_at DESC
        LIMIT 1
      ) a ON TRUE
    ), priced AS (
      SELECT
        x.biz_type,
        x.dish_name,
        x.resolved_dish_name,
        x.qty,
        x.sales_amount,
        x.revenue,
        c.unit_cost
      FROM resolved x
      LEFT JOIN LATERAL (
        SELECT dlc.unit_cost
        FROM dish_library_costs dlc
        WHERE dlc.enabled = TRUE
          AND ${DISH_NAME_NORMALIZE_SQL('dlc.dish_name')} = ${DISH_NAME_NORMALIZE_SQL('x.resolved_dish_name')}
          AND (
            lower(regexp_replace(COALESCE(dlc.store, '*'), '\\s+', '', 'g')) = lower(regexp_replace(COALESCE(x.store, ''), '\\s+', '', 'g'))
            OR COALESCE(NULLIF(trim(dlc.store), ''), '*') = '*'
          )
          AND (
            dlc.brand = '*'
            OR dlc.brand = (CASE WHEN x.store LIKE '%洪潮%' THEN '洪潮' WHEN x.store LIKE '%马己仙%' THEN '马己仙' END)
          )
          AND ${BIZ_MATCH_WHERE_SQL('dlc.biz_type', 'x.biz_type')}
        ORDER BY
          ${BIZ_PRIORITY_SQL('dlc.biz_type', 'x.biz_type')},
          CASE WHEN dlc.brand = '*' THEN 2 ELSE 1 END,
          CASE WHEN COALESCE(NULLIF(trim(dlc.store), ''), '*') = '*' THEN 2 ELSE 1 END,
          dlc.updated_at DESC
        LIMIT 1
      ) c ON TRUE
    )
  `;
}

export function buildCostCoverageSummarySql(deps) {
  return `${buildCostCoverageBaseCteSql(deps)}
    SELECT
      biz_type,
      ROUND(SUM(sales_amount)::numeric, 2) AS total_sales,
      ROUND(SUM(CASE WHEN unit_cost IS NOT NULL THEN sales_amount ELSE 0 END)::numeric, 2) AS covered_sales,
      ROUND(SUM(revenue)::numeric, 2) AS total_revenue,
      ROUND(SUM(CASE WHEN unit_cost IS NOT NULL THEN revenue ELSE 0 END)::numeric, 2) AS covered_revenue
    FROM priced
    GROUP BY biz_type
  `;
}

export function buildCostCoverageUnmatchedSql(deps) {
  return `${buildCostCoverageBaseCteSql(deps)}
    SELECT
      biz_type,
      dish_name,
      resolved_dish_name,
      ROUND(SUM(sales_amount)::numeric, 2) AS sales,
      ROUND(SUM(revenue)::numeric, 2) AS revenue,
      ROUND(SUM(qty)::numeric, 2) AS qty
    FROM priced
    WHERE unit_cost IS NULL
    GROUP BY biz_type, dish_name, resolved_dish_name
    ORDER BY SUM(sales_amount) DESC
    LIMIT $4
  `;
}

export function aggregateCostCoverageResults(summaryRows, unmatchedRows) {
  const byBiz = {
    dinein: { totalSales: 0, coveredSales: 0, totalRevenue: 0, coveredRevenue: 0, salesCoveragePct: null, revenueCoveragePct: null },
    takeaway: { totalSales: 0, coveredSales: 0, totalRevenue: 0, coveredRevenue: 0, salesCoveragePct: null, revenueCoveragePct: null },
  };

  for (const row of summaryRows || []) {
    const biz = String(row.biz_type || '').trim();
    if (!byBiz[biz]) continue;
    const totalSales = toNum(row.total_sales);
    const coveredSales = toNum(row.covered_sales);
    const totalRevenue = toNum(row.total_revenue);
    const coveredRevenue = toNum(row.covered_revenue);
    byBiz[biz] = {
      totalSales,
      coveredSales,
      totalRevenue,
      coveredRevenue,
      salesCoveragePct: pct(coveredSales, totalSales),
      revenueCoveragePct: pct(coveredRevenue, totalRevenue),
    };
  }

  const totalSales = byBiz.dinein.totalSales + byBiz.takeaway.totalSales;
  const coveredSales = byBiz.dinein.coveredSales + byBiz.takeaway.coveredSales;
  const totalRevenue = byBiz.dinein.totalRevenue + byBiz.takeaway.totalRevenue;
  const coveredRevenue = byBiz.dinein.coveredRevenue + byBiz.takeaway.coveredRevenue;

  return {
    byBiz,
    total: {
      totalSales,
      coveredSales,
      totalRevenue,
      coveredRevenue,
      salesCoveragePct: pct(coveredSales, totalSales),
      revenueCoveragePct: pct(coveredRevenue, totalRevenue),
    },
    unmatchedTop: (unmatchedRows || []).map((row) => ({
      bizType: String(row.biz_type || '').trim(),
      dishName: String(row.dish_name || '').trim(),
      resolvedDishName: String(row.resolved_dish_name || '').trim(),
      sales: toNum(row.sales),
      revenue: toNum(row.revenue),
      qty: toNum(row.qty),
    })),
  };
}

export async function runQueryCostCoverageDiagnostics(pool, store, startDate, endDate, unmatchedLimit, deps) {
  const limit = Math.max(1, Math.min(30, Number(unmatchedLimit) || 12));
  const [summary, unmatched] = await Promise.all([
    pool.query(buildCostCoverageSummarySql(deps), [store, startDate, endDate]),
    pool.query(buildCostCoverageUnmatchedSql(deps), [store, startDate, endDate, limit]),
  ]);
  return aggregateCostCoverageResults(summary.rows, unmatched.rows);
}
