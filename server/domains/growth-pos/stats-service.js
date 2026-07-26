import { queryDefaultPosStatsCore, queryDefaultPosStatsDetail } from './stats-default-queries.js';
import { assembleDefaultPosStats } from './stats-default-assemble.js';
import { cleanText } from '../growth-phase-auth.js';

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
  const core = await queryDefaultPosStatsCore(pool, { posCond, itemsCond, reportStoreCond, statsParams });
  const detail = await queryDefaultPosStatsDetail(pool, { posCond, itemsCond, statsParams });
  return assembleDefaultPosStats(pool, sid, days, core, detail);
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
