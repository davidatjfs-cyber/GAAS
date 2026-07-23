import { cleanText } from '../growth-phase-auth.js';
import { fetchDineMetricsForDays, resolveStoreCanonicalName } from '../../utils/dine-metrics.js';

function parsePosStatsQuery(query = {}) {
  const sid = cleanText(query.store_id || query.store_name || '', 200);
  const campaignId = cleanText(query.campaign_id || '', 128);
  const days = Math.min(Math.max(Number(query.days) || 30, 1), 365);
  const byName = /[\u4e00-\u9fff\uff08\uff09【】]/.test(sid);
  return { sid, campaignId, days, byName };
}

function buildPosStatsConds(sid, byName) {
  const posCond = sid ? (byName ? `store_name = $1` : `store_id = $1`) : `$1::text = ''`;
  const itemsCond = sid ? (byName ? `store_name = $1` : `store_code = $1`) : `$1::text = ''`;
  const reportStoreCond = sid
    ? (byName
      ? `store = $1`
      : `(CASE WHEN $1 = '51866138' THEN store ILIKE '%马己仙%' WHEN $1 = '64822111' THEN store ILIKE '%洪潮%' ELSE store = $1 END)`)
    : `$1::text = ''`;
  return { posCond, itemsCond, reportStoreCond };
}

async function getCampaignPosStats(pool, { sid, days, campaignId, byName }) {
  const params = [sid, days, campaignId];
  const campaignPosWhere = `
    FROM pos_orders po
    JOIN (
      SELECT DISTINCT phone FROM growth_events
      WHERE campaign_id = $3 AND phone IS NOT NULL AND phone <> ''
    ) cp ON cp.phone = po.phone
    WHERE ${sid ? (byName ? `po.store_name = $1` : `po.store_id = $1`) : `$1::text = ''`}
      AND po.biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
  `;
  const [summaryR, distR, byStoreR] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total_orders,
        COALESCE(SUM(po.amount_after_discount),0)::numeric AS total_revenue,
        COALESCE(SUM(po.amount_before_discount),0)::numeric AS total_before_revenue,
        COUNT(*) FILTER (WHERE po.order_type = '堂食')::int AS dine_pos_orders,
        COALESCE(SUM(po.amount_before_discount) FILTER (WHERE po.order_type = '堂食'),0)::numeric AS dine_pos_before_revenue,
        ROUND(COALESCE(SUM(po.amount_before_discount) FILTER (WHERE po.order_type = '堂食'),0) / NULLIF(COUNT(*) FILTER (WHERE po.order_type = '堂食'),0),2) AS avg_table_spend,
        COUNT(DISTINCT NULLIF(po.phone,''))::int AS distinct_phones
      ${campaignPosWhere}`, params),
    pool.query(`SELECT CASE
        WHEN po.amount_before_discount < 200 THEN '0-200'
        WHEN po.amount_before_discount < 400 THEN '200-400'
        WHEN po.amount_before_discount < 600 THEN '400-600'
        WHEN po.amount_before_discount < 800 THEN '600-800'
        ELSE '800+' END AS spend_tier,
        COUNT(*)::int AS cnt
      ${campaignPosWhere}
        AND po.order_type = '堂食'
      GROUP BY 1 ORDER BY 1`, params),
    pool.query(`SELECT po.store_id, po.store_name, COUNT(*)::int AS orders,
        ROUND(AVG(po.amount_after_discount),2) AS avg_check,
        COALESCE(SUM(po.amount_after_discount),0)::numeric AS total_revenue
      ${campaignPosWhere}
      GROUP BY po.store_id, po.store_name ORDER BY total_revenue DESC`, params),
  ]);
  const summary = {
    ...(summaryR.rows[0] || {}),
    data_source: 'campaign_pos_orders',
    report_days: 0,
  };
  const totalCustomers = Number(summary.distinct_phones || 0);
  const profileInsights = {
    lifecycle: {},
    value_tier: {},
    avg_spend_dist: Object.fromEntries(distR.rows.map((r) => [r.spend_tier, r.cnt])),
    avg_table_spend: summary.avg_table_spend || 0,
    customer_metrics: {
      total_customers: totalCustomers,
      new_count: 0,
      active_count: 0,
      vip_count: 0,
      churn_rate: 0,
      repurchase_rate: 0,
      repurchase_detail: { repurchasers: 0, total_with_orders_30d: totalCustomers },
    },
    new_vs_returning: {
      new_count: 0,
      returning_count: 0,
      total_customers: totalCustomers,
      new_pct: 0,
      returning_pct: 0,
    },
    top_visit_times: {},
    top_dish_categories: {},
    high_value_customers: { count: totalCustomers },
    cust_order_type: {},
    cust_order_source: {},
    cust_dept: {},
  };
  return {
    ok: true,
    summary,
    byStore: byStoreR.rows,
    hourDist: [],
    payDist: [],
    topDishes: [],
    repeatStats: {},
    profileInsights,
    byOrderType: [],
    byOrderSource: [],
    byDept: [],
  };
}

async function getDefaultPosStats(pool, { sid, days, byName }) {
  const { posCond, itemsCond, reportStoreCond } = buildPosStatsConds(sid, byName);
  const statsParams = [sid, days];

  const [
    summaryR, storeR, hourR, payR, dishR, repeatR, reportSummaryR,
  ] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total_orders,
      COALESCE(SUM(amount_after_discount),0)::numeric AS total_revenue,
      COALESCE(SUM(amount_before_discount),0)::numeric AS total_before_revenue,
      COALESCE(SUM(COALESCE(NULLIF(diners,0),1)),0)::int AS total_diners,
      ROUND(COALESCE(SUM(amount_before_discount),0) / NULLIF(SUM(COALESCE(NULLIF(diners,0),1)),0),2) AS avg_spend_per_person,
      COUNT(*) FILTER (WHERE order_type = '堂食')::int AS dine_pos_orders,
      COALESCE(SUM(amount_before_discount) FILTER (WHERE order_type = '堂食'),0)::numeric AS dine_pos_before_revenue,
      ROUND(COALESCE(SUM(amount_before_discount) FILTER (WHERE order_type = '堂食'),0) / NULLIF(COUNT(*) FILTER (WHERE order_type = '堂食'),0),2) AS avg_table_spend,
      ROUND(AVG(amount_after_discount),2) AS avg_check,
      COUNT(DISTINCT NULLIF(phone, '')) AS distinct_phones,
      COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone <> '')::int AS identified_orders
      FROM pos_orders
      WHERE ${posCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval`, statsParams),
    pool.query(`SELECT store_id, store_name, COUNT(*)::int AS orders,
      ROUND(AVG(amount_after_discount),2) AS avg_check,
      COALESCE(SUM(amount_after_discount),0)::numeric AS total_revenue
      FROM pos_orders
      WHERE ${posCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      GROUP BY store_id, store_name ORDER BY total_revenue DESC`, statsParams),
    pool.query(`SELECT EXTRACT(HOUR FROM order_time)::int AS hour, COUNT(*)::int AS orders,
      COALESCE(SUM(amount_after_discount),0)::numeric AS revenue
      FROM pos_orders
      WHERE order_time IS NOT NULL
        AND ${posCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      GROUP BY 1 ORDER BY 1`, statsParams),
    pool.query(`SELECT
      CASE
        WHEN payment_method LIKE '%微信%' THEN '微信'
        WHEN payment_method LIKE '%支付宝%' THEN '支付宝'
        WHEN payment_method LIKE '%会员卡%' THEN '会员卡'
        WHEN payment_method LIKE '%现金%' THEN '现金'
        WHEN payment_method LIKE '%套餐%' THEN '套餐'
        WHEN payment_method LIKE '%代金券%' THEN '代金券'
        ELSE '其他'
      END AS pay_group,
      COUNT(*)::int AS orders,
      COALESCE(SUM(amount_after_discount),0)::numeric AS revenue
      FROM pos_orders
      WHERE ${posCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      GROUP BY 1 ORDER BY orders DESC`, statsParams),
    pool.query(`SELECT category, dish_name,
      SUM(qty)::int AS total_qty,
      COALESCE(SUM(amount_after_discount),0)::numeric AS revenue
      FROM pos_order_items WHERE order_no IN (
        SELECT order_no FROM pos_orders
        WHERE ${posCond}
          AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      ) AND category IS NOT NULL AND category <> '-'
      GROUP BY category, dish_name
      ORDER BY revenue DESC LIMIT 15`, statsParams),
    pool.query(`WITH customer_window AS (
        SELECT
          phone,
          COUNT(*)::int AS order_cnt,
          MIN(biz_date) AS first_order_date
        FROM pos_orders
        WHERE phone IS NOT NULL AND phone <> ''
          AND ${posCond}
          AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
        GROUP BY phone
      ), customer_life AS (
        SELECT cw.*, MIN(po.biz_date) AS lifetime_first_order_date
        FROM customer_window cw
        JOIN pos_orders po ON po.phone = cw.phone
          AND po.phone IS NOT NULL AND po.phone <> ''
          AND ${posCond}
        GROUP BY cw.phone, cw.order_cnt, cw.first_order_date
      )
      SELECT
        COUNT(*) FILTER (WHERE order_cnt = 1)::int AS one_timer,
        COUNT(*) FILTER (WHERE order_cnt = 2)::int AS two_timer,
        COUNT(*) FILTER (WHERE order_cnt >= 3)::int AS repeat_3plus,
        COUNT(*) FILTER (WHERE lifetime_first_order_date >= CURRENT_DATE - ($2::int || ' days')::interval)::int AS new_customers,
        COUNT(*) FILTER (WHERE lifetime_first_order_date < CURRENT_DATE - ($2::int || ' days')::interval)::int AS returning_customers,
        COUNT(*) FILTER (WHERE order_cnt >= 2)::int AS repeat_customers,
        COUNT(*)::int AS total_customers
      FROM (
        SELECT * FROM customer_life
      ) sub`, statsParams),
    pool.query(`SELECT
        COUNT(*)::int AS report_days,
        COALESCE(SUM(actual_revenue),0)::numeric AS report_total_revenue,
        COALESCE(SUM(pre_discount_revenue),0)::numeric AS report_total_before_revenue,
        COALESCE(SUM(dine_traffic),0)::int AS report_total_diners,
        COALESCE(SUM(dine_orders),0)::int AS report_dine_orders,
        COALESCE(SUM(delivery_actual),0)::numeric AS report_delivery_revenue,
        COALESCE(SUM(
          COALESCE((delivery_detail->'eleme'->>'orders')::numeric, 0)
          + COALESCE((delivery_detail->'meituan'->>'orders')::numeric, 0)
        ),0)::int AS report_delivery_orders,
        ROUND(COALESCE(SUM(pre_discount_revenue),0) / NULLIF(SUM(dine_traffic),0),2) AS report_avg_spend_per_person
      FROM daily_reports
      WHERE ${reportStoreCond}
        AND date >= CURRENT_DATE - ($2::int || ' days')::interval`, statsParams),
  ]);

  const [
    byOrderTypeR, byOrderSourceR, byDeptR, periodProfileR, spendDistR, visitR, dishCatR,
    custOrderTypeR, custOrderSourceR, custDeptR,
  ] = await Promise.all([
    pool.query(`SELECT order_type, COUNT(DISTINCT order_no)::int AS cnt,
      COUNT(*)::int AS line_count,
      COALESCE(SUM(amount_after_discount),0)::numeric AS revenue,
      COALESCE(SUM(qty),0)::int AS total_qty
      FROM pos_order_items
      WHERE ${itemsCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      GROUP BY order_type ORDER BY revenue DESC`, statsParams),
    pool.query(`SELECT order_source, COUNT(*)::int AS cnt,
      COALESCE(SUM(amount_after_discount),0)::numeric AS revenue,
      COALESCE(SUM(qty),0)::int AS total_qty
      FROM pos_order_items
      WHERE ${itemsCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      GROUP BY order_source ORDER BY revenue DESC`, statsParams),
    pool.query(`SELECT department, COUNT(*)::int AS cnt,
      COALESCE(SUM(amount_after_discount),0)::numeric AS revenue,
      COALESCE(SUM(qty),0)::int AS total_qty
      FROM pos_order_items
      WHERE ${itemsCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
        AND department IS NOT NULL AND department <> ''
      GROUP BY department ORDER BY revenue DESC`, statsParams),
    pool.query(`WITH period_orders AS (
        SELECT phone, biz_date, amount_before_discount,
               COALESCE(NULLIF(diners, 0), 1)::numeric AS diners
        FROM pos_orders
        WHERE phone IS NOT NULL AND phone <> ''
          AND ${posCond}
          AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      ), period_stats AS (
        SELECT
          phone,
          COUNT(*)::int AS orders_in_period,
          ROUND(SUM(amount_before_discount) / NULLIF(SUM(diners), 0), 2) AS avg_check_period,
          MIN(biz_date) AS first_in_period,
          MAX(biz_date) AS last_in_period
        FROM period_orders
        GROUP BY phone
      ), lifetime_stats AS (
        SELECT
          ps.phone,
          ps.orders_in_period,
          ps.avg_check_period,
          MIN(po.biz_date) AS lifetime_first,
          MAX(po.biz_date) AS lifetime_last,
          COUNT(DISTINCT po.order_no)::int AS lifetime_orders
        FROM period_stats ps
        JOIN pos_orders po
          ON po.phone = ps.phone
         AND po.phone IS NOT NULL AND po.phone <> ''
         AND ${posCond}
        GROUP BY ps.phone, ps.orders_in_period, ps.avg_check_period
      ), classified AS (
        SELECT
          ls.*,
          CASE
            WHEN ls.lifetime_last >= CURRENT_DATE - INTERVAL '14 days'
                 AND ls.lifetime_orders = 1 THEN 'new'
            WHEN ls.lifetime_last >= CURRENT_DATE - INTERVAL '14 days'
                 AND ls.lifetime_orders >= 2 THEN 'active'
            WHEN ls.lifetime_last >= CURRENT_DATE - INTERVAL '30 days' THEN 'at_risk'
            WHEN ls.lifetime_last < CURRENT_DATE - INTERVAL '365 days' THEN 'lost_365'
            WHEN ls.lifetime_last < CURRENT_DATE - INTERVAL '180 days' THEN 'lost_180'
            WHEN ls.lifetime_last < CURRENT_DATE - INTERVAL '90 days' THEN 'lost_90'
            WHEN ls.lifetime_orders >= 2 THEN 'dormant'
            ELSE 'churned'
          END AS lifecycle_stage
        FROM lifetime_stats ls
      ), ranked AS (
        SELECT
          phone,
          PERCENT_RANK() OVER (
            ORDER BY COALESCE(avg_check_period, 0) DESC, phone
          ) AS spend_pct
        FROM classified
        WHERE COALESCE(avg_check_period, 0) > 0
      ), with_tier AS (
        SELECT
          c.*,
          CASE
            WHEN COALESCE(c.avg_check_period, 0) <= 0 THEN 'low'
            WHEN rk.spend_pct <= 0.15 THEN 'vip'
            WHEN rk.spend_pct <= 0.50 THEN 'regular'
            ELSE 'low'
          END AS value_tier
        FROM classified c
        LEFT JOIN ranked rk ON rk.phone = c.phone
      ), lc AS (
        SELECT lifecycle_stage, COUNT(*)::int AS cnt FROM with_tier GROUP BY lifecycle_stage
      ), vt AS (
        SELECT value_tier, COUNT(*)::int AS cnt FROM with_tier GROUP BY value_tier
      )
      SELECT
        (SELECT COUNT(*)::int FROM with_tier) AS total_customers,
        (SELECT COUNT(*)::int FROM with_tier
          WHERE lifetime_first >= CURRENT_DATE - ($2::int || ' days')::interval) AS new_count,
        (SELECT COUNT(*)::int FROM with_tier
          WHERE lifetime_first < CURRENT_DATE - ($2::int || ' days')::interval) AS returning_count,
        (SELECT COUNT(*)::int FROM with_tier WHERE lifecycle_stage = 'active') AS active_count,
        (SELECT COUNT(*)::int FROM with_tier WHERE lifecycle_stage = 'at_risk') AS at_risk_count,
        (SELECT COUNT(*)::int FROM with_tier WHERE lifecycle_stage = 'dormant') AS dormant_count,
        (SELECT COUNT(*)::int FROM with_tier WHERE lifecycle_stage = 'churned') AS churned_count,
        (SELECT COUNT(*)::int FROM with_tier WHERE value_tier = 'vip') AS vip_count,
        (SELECT COUNT(*)::int FROM with_tier WHERE orders_in_period >= 2) AS repurchasers,
        (SELECT COALESCE(jsonb_object_agg(lifecycle_stage, cnt), '{}'::jsonb) FROM lc) AS lifecycle_json,
        (SELECT COALESCE(jsonb_object_agg(value_tier, cnt), '{}'::jsonb) FROM vt) AS value_tier_json,
        (SELECT COUNT(*)::int FROM with_tier) AS high_value_count,
        (SELECT ROUND(AVG(avg_check_period)::numeric, 2) FROM with_tier WHERE value_tier = 'vip') AS vip_avg_check,
        (SELECT ROUND(AVG(orders_in_period)::numeric, 1) FROM with_tier) AS avg_orders`, statsParams),
    pool.query(`SELECT CASE
        WHEN amount_before_discount < 200 THEN '0-200'
        WHEN amount_before_discount < 400 THEN '200-400'
        WHEN amount_before_discount < 600 THEN '400-600'
        WHEN amount_before_discount < 800 THEN '600-800'
        ELSE '800+' END AS spend_tier, COUNT(*)::int AS cnt
      FROM pos_orders
      WHERE order_type = '堂食'
        AND ${posCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      GROUP BY 1 ORDER BY 1`, statsParams),
    pool.query(`SELECT CASE
        WHEN EXTRACT(HOUR FROM order_time) BETWEEN 10 AND 14 THEN '午市(10-14点)'
        WHEN EXTRACT(HOUR FROM order_time) BETWEEN 17 AND 21 THEN '晚市(17-21点)'
        ELSE '其他时段' END AS visit_time, COUNT(*)::int AS cnt
      FROM pos_orders
      WHERE phone IS NOT NULL AND phone <> ''
        AND order_time IS NOT NULL
        AND ${posCond}
        AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      GROUP BY 1 ORDER BY cnt DESC`, statsParams),
    pool.query(`SELECT category, SUM(qty)::int AS total_qty FROM pos_order_items WHERE order_no IN (
        SELECT order_no FROM pos_orders
        WHERE phone IS NOT NULL AND phone <> ''
          AND ${posCond}
          AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      ) AND category IS NOT NULL AND category <> '-' GROUP BY category ORDER BY total_qty DESC LIMIT 5`, statsParams),
    pool.query(`SELECT order_type, COUNT(*)::int AS cnt
      FROM pos_order_items WHERE order_no IN (
        SELECT order_no FROM pos_orders
        WHERE phone IS NOT NULL AND phone <> ''
          AND ${posCond}
          AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      ) AND order_type IS NOT NULL AND order_type <> ''
      GROUP BY order_type ORDER BY cnt DESC`, statsParams),
    pool.query(`SELECT order_source, COUNT(*)::int AS cnt
      FROM pos_order_items WHERE order_no IN (
        SELECT order_no FROM pos_orders
        WHERE phone IS NOT NULL AND phone <> ''
          AND ${posCond}
          AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      ) AND order_source IS NOT NULL AND order_source <> ''
      GROUP BY order_source ORDER BY cnt DESC`, statsParams),
    pool.query(`SELECT department, SUM(qty)::int AS total_qty
      FROM pos_order_items WHERE order_no IN (
        SELECT order_no FROM pos_orders
        WHERE phone IS NOT NULL AND phone <> ''
          AND ${posCond}
          AND biz_date >= CURRENT_DATE - ($2::int || ' days')::interval
      ) AND department IS NOT NULL AND department <> ''
      GROUP BY department ORDER BY total_qty DESC`, statsParams),
  ]);

  const periodRow = periodProfileR.rows[0] || {};
  const lcCounts = periodRow.lifecycle_json || {};
  const tierCounts = periodRow.value_tier_json || {};
  const everEngaged = (lcCounts.new || 0) + (lcCounts.active || 0) + (lcCounts.at_risk || 0)
    + (lcCounts.dormant || 0) + (lcCounts.churned || 0)
    + (lcCounts.lost_90 || 0) + (lcCounts.lost_180 || 0) + (lcCounts.lost_365 || 0);
  const lostCount = (lcCounts.dormant || 0) + (lcCounts.churned || 0)
    + (lcCounts.lost_90 || 0) + (lcCounts.lost_180 || 0) + (lcCounts.lost_365 || 0);
  const churnRate = everEngaged ? Math.round((lostCount / everEngaged) * 1000) / 10 : 0;

  const recentCustomers = Number(periodRow.total_customers || 0);
  const newCustomerCount = Number(periodRow.new_count || 0);
  const returningCustomerCount = Number(periodRow.returning_count || 0);
  const repurchasers = Number(periodRow.repurchasers || 0);
  const repurchaseRate = recentCustomers ? Math.round((repurchasers / recentCustomers) * 1000) / 10 : 0;

  const rawSummary = summaryR.rows[0] || {};
  const reportSummary = reportSummaryR.rows[0] || {};
  const reportDays = Number(reportSummary.report_days || 0);
  const mergedSummary = {
    ...rawSummary,
    total_orders: reportDays > 0
      ? Number(reportSummary.report_dine_orders || 0) + Number(reportSummary.report_delivery_orders || 0)
      : rawSummary.total_orders,
    total_revenue: reportDays > 0 ? reportSummary.report_total_revenue : rawSummary.total_revenue,
    total_before_revenue: reportDays > 0 ? reportSummary.report_total_before_revenue : rawSummary.total_before_revenue,
    total_diners: reportDays > 0 ? Number(reportSummary.report_total_diners || 0) : rawSummary.total_diners,
    avg_spend_per_person: reportDays > 0 ? reportSummary.report_avg_spend_per_person : rawSummary.avg_spend_per_person,
    dine_pos_orders: Number(rawSummary.dine_pos_orders || 0),
    dine_pos_before_revenue: rawSummary.dine_pos_before_revenue || 0,
    avg_table_spend: rawSummary.avg_table_spend || 0,
    dine_orders: reportDays > 0 ? Number(reportSummary.report_dine_orders || 0) : null,
    delivery_orders: reportDays > 0 ? Number(reportSummary.report_delivery_orders || 0) : null,
    delivery_revenue: reportDays > 0 ? reportSummary.report_delivery_revenue : null,
    report_days: reportDays,
    data_source: reportDays > 0 ? 'daily_reports' : 'pos_orders',
  };

  const metricsStoreName = resolveStoreCanonicalName(sid);
  if (metricsStoreName) {
    const dine = await fetchDineMetricsForDays(pool, metricsStoreName, days);
    mergedSummary.total_diners = dine.dine_traffic;
    mergedSummary.dine_orders = dine.dine_orders;
    mergedSummary.dine_before_revenue = dine.dine_before_revenue;
    mergedSummary.avg_table_spend = dine.avg_table_spend;
    mergedSummary.avg_spend_per_person = dine.avg_spend_per_person;
    mergedSummary.dine_data_source = dine.data_source;
    mergedSummary.data_source = dine.data_source;
  }

  const profileInsights = {
    lifecycle: lcCounts,
    value_tier: tierCounts,
    stats_days: days,
    churn_rate: churnRate,
    churn_detail: {
      lost: lostCount,
      ever_engaged: everEngaged,
      dormant: lcCounts.dormant || 0,
      churned: lcCounts.churned || 0,
    },
    customer_metrics: {
      total_customers: recentCustomers,
      new_count: newCustomerCount,
      returning_count: returningCustomerCount,
      active_count: Number(periodRow.active_count || 0),
      at_risk_count: Number(periodRow.at_risk_count || 0),
      dormant_count: Number(periodRow.dormant_count || 0),
      churned_count: Number(periodRow.churned_count || 0),
      vip_count: Number(periodRow.vip_count || 0),
      churn_rate: churnRate,
      repurchase_rate: repurchaseRate,
      repurchase_detail: { repurchasers, total_with_orders: recentCustomers },
    },
    avg_spend_dist: Object.fromEntries(spendDistR.rows.map((r) => [r.spend_tier, r.cnt])),
    avg_table_spend: mergedSummary.avg_table_spend,
    top_visit_times: Object.fromEntries(visitR.rows.map((r) => [r.visit_time, r.cnt])),
    top_dish_categories: Object.fromEntries(dishCatR.rows.map((r) => [r.category, r.total_qty])),
    high_value_customers: {
      count: Number(periodRow.high_value_count || 0),
      avg_spending: periodRow.vip_avg_check,
      avg_orders: periodRow.avg_orders,
    },
    new_vs_returning: {
      new_count: newCustomerCount,
      returning_count: returningCustomerCount,
      total_customers: recentCustomers,
      new_pct: recentCustomers ? Math.round((newCustomerCount / recentCustomers) * 1000) / 10 : 0,
      returning_pct: recentCustomers ? Math.round((returningCustomerCount / recentCustomers) * 1000) / 10 : 0,
    },
    cust_order_type: Object.fromEntries(custOrderTypeR.rows.map((r) => [r.order_type, r.cnt])),
    cust_order_source: Object.fromEntries(custOrderSourceR.rows.map((r) => [r.order_source, r.cnt])),
    cust_dept: Object.fromEntries(custDeptR.rows.map((r) => [r.department, r.total_qty])),
  };

  return {
    ok: true,
    summary: mergedSummary,
    byStore: storeR.rows,
    hourDist: hourR.rows,
    payDist: payR.rows,
    topDishes: dishR.rows,
    repeatStats: repeatR.rows[0] || {},
    profileInsights,
    byOrderType: byOrderTypeR.rows,
    byOrderSource: byOrderSourceR.rows,
    byDept: byDeptR.rows,
  };
}

/**
 * @param {any} pool
 * @param {Record<string, string|number|undefined>} query
 */
export async function getPosStats(pool, query) {
  const parsed = parsePosStatsQuery(query);
  if (parsed.campaignId) {
    return getCampaignPosStats(pool, parsed);
  }
  return getDefaultPosStats(pool, parsed);
}

export { parsePosStatsQuery };
