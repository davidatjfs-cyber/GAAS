/**
 * 增长菜单健康报告：growth_menu_health_reports 读写（从 growth-phases 外提）。
 * 不接触 req/res。
 */
import { cleanText } from '../growth-phase-auth.js';

function todayShanghaiYmd() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

export function safeMonthOnly(value) {
  const s = cleanText(value, 32);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 7);
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ storeCode?: string, reportMonth?: string }} opts
 */
export async function listMenuHealthReports(pool, opts = {}) {
  const storeCode = cleanText(opts.storeCode || '', 128);
  const reportMonth = safeMonthOnly(opts.reportMonth || '');
  const r = await pool.query(
    `SELECT id, report_month, store_code, generated_by, created_at,
            report_json->'summary' AS summary,
            report_json->'recommendations' AS recommendations
       FROM growth_menu_health_reports
      WHERE ($1 = '' OR store_code = $1)
        AND ($2 = '' OR report_month = $2)
      ORDER BY report_month DESC, created_at DESC
      LIMIT 50`,
    [storeCode, reportMonth]
  );
  return r.rows || [];
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} month
 * @param {string} [storeCode='']
 */
export async function getMenuHealthReportsByMonth(pool, month, storeCode = '') {
  const store = cleanText(storeCode, 128);
  const r = await pool.query(
    `SELECT * FROM growth_menu_health_reports
      WHERE report_month = $1 AND ($2 = '' OR store_code = $2)
      LIMIT 10`,
    [month, store]
  );
  return r.rows || [];
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} storeCode
 * @param {string} reportMonth
 * @param {string} [tenantId='default']
 */
export async function generateMenuHealthReport(pool, storeCode, reportMonth, tenantId = 'default') {
  const store = cleanText(storeCode, 128);
  const month = safeMonthOnly(reportMonth) || todayShanghaiYmd().slice(0, 7);
  const prevMonth = (() => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();

  const storeCond = store ? `AND store_code = $3` : '';
  const params = [month, prevMonth, ...(store ? [store] : [])];

  const r = await pool.query(
    `WITH cur AS (
       SELECT dish_name, category,
              SUM(qty)::numeric AS qty,
              SUM(amount_after_discount)::numeric AS revenue,
              AVG(unit_price)::numeric AS avg_price
       FROM pos_order_items
       WHERE TO_CHAR(biz_date, 'YYYY-MM') = $1 ${storeCond}
       GROUP BY dish_name, category
     ),
     prev AS (
       SELECT dish_name,
              SUM(qty)::numeric AS prev_qty,
              SUM(amount_after_discount)::numeric AS prev_revenue
       FROM pos_order_items
       WHERE TO_CHAR(biz_date, 'YYYY-MM') = $2 ${storeCond}
       GROUP BY dish_name
     ),
     total AS (SELECT SUM(revenue) AS total_rev FROM cur)
     SELECT c.dish_name, c.category, c.qty, c.revenue, c.avg_price,
            COALESCE(p.prev_qty, 0) AS prev_qty,
            COALESCE(p.prev_revenue, 0) AS prev_revenue,
            t.total_rev,
            CASE WHEN c.revenue > 0 AND t.total_rev > 0
                 THEN ROUND((c.revenue / t.total_rev * 100)::numeric, 2) ELSE 0 END AS revenue_share_pct,
            CASE WHEN p.prev_qty > 0
                 THEN ROUND(((c.qty - p.prev_qty) / p.prev_qty * 100)::numeric, 2) ELSE NULL END AS qty_mom_pct,
            CASE WHEN p.prev_revenue > 0
                 THEN ROUND(((c.revenue - p.prev_revenue) / p.prev_revenue * 100)::numeric, 2) ELSE NULL END AS rev_mom_pct
     FROM cur c
     LEFT JOIN prev p ON p.dish_name = c.dish_name
     CROSS JOIN total t
     ORDER BY c.revenue DESC`,
    params
  );

  const rows = r.rows || [];
  const totalRevAll = Number(rows[0]?.total_rev || 0);
  const medianRevShare = rows.length > 0
    ? Number(rows[Math.floor(rows.length / 2)]?.revenue_share_pct || 0)
    : 0;

  const growing = rows
    .filter((x) => Number(x.qty_mom_pct || 0) > 10)
    .slice(0, 10)
    .map((x) => ({ dish_name: x.dish_name, category: x.category, qty_mom_pct: Number(x.qty_mom_pct), revenue: Number(x.revenue) }));

  const declining = rows
    .filter((x) => x.prev_qty > 0 && Number(x.qty_mom_pct || 0) < -10)
    .sort((a, b) => Number(a.qty_mom_pct || 0) - Number(b.qty_mom_pct || 0))
    .slice(0, 10)
    .map((x) => ({ dish_name: x.dish_name, category: x.category, qty_mom_pct: Number(x.qty_mom_pct), revenue: Number(x.revenue) }));

  const avgPrice = rows.length > 0
    ? rows.reduce((s, row) => s + Number(row.avg_price || 0), 0) / rows.length
    : 0;
  const highProfitLowExposure = rows
    .filter((x) => Number(x.avg_price || 0) > avgPrice * 1.2 && Number(x.revenue_share_pct || 0) < medianRevShare)
    .slice(0, 10)
    .map((x) => ({ dish_name: x.dish_name, category: x.category, avg_price: Number(x.avg_price), revenue_share_pct: Number(x.revenue_share_pct) }));

  const report = {
    report_month: month,
    store_code: store,
    period: { current: month, previous: prevMonth },
    summary: {
      total_dishes: rows.length,
      total_revenue: totalRevAll,
      growing_count: growing.length,
      declining_count: declining.length,
      high_profit_low_exposure_count: highProfitLowExposure.length,
    },
    growing,
    declining,
    high_profit_low_exposure: highProfitLowExposure,
    top10: rows.slice(0, 10).map((x) => ({
      dish_name: x.dish_name, category: x.category, revenue: Number(x.revenue),
      qty: Number(x.qty), revenue_share_pct: Number(x.revenue_share_pct), qty_mom_pct: x.qty_mom_pct,
    })),
    recommendations: [
      ...growing.slice(0, 3).map((x) => `【加大推广】${x.dish_name}：环比增长${x.qty_mom_pct}%，建议增加曝光`),
      ...declining.slice(0, 3).map((x) => `【考虑调整】${x.dish_name}：环比下降${Math.abs(x.qty_mom_pct)}%，评估是否下架或优化`),
      ...highProfitLowExposure.slice(0, 3).map((x) => `【值得主推】${x.dish_name}：均价¥${Number(x.avg_price).toFixed(0)}但曝光低（仅占${x.revenue_share_pct}%），有利润空间`),
    ],
  };

  const saved = await pool.query(
    `INSERT INTO growth_menu_health_reports (report_month, store_code, report_json, generated_by, tenant_id)
     VALUES ($1, $2, $3::jsonb, 'system', $4)
     ON CONFLICT (report_month, store_code, tenant_id)
     DO UPDATE SET report_json = EXCLUDED.report_json, created_at = NOW()
     RETURNING *`,
    [month, store || '', JSON.stringify(report), tenantId]
  );
  return saved.rows[0] || null;
}
