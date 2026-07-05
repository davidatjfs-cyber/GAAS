/**
 * 堂食桌均 / 堂食人均 — 与营业日报、POS 订单统一口径。
 *
 * 堂食桌均 = 折前堂食营业额 / 堂食订单数
 * 堂食人均 = 折前堂食营业额 / 堂食客流量
 *
 * 折前堂食营业额：pos_orders.amount_before_discount（order_type=堂食）优先；
 *   无 POS 时 fallback 日报 (pre_discount_revenue - delivery_pre_revenue)。
 * 堂食订单数 / 客流量：POS 堂食订单数、diners 求和优先（与客如云一致）；
 *   无 POS 时用 daily_reports.dine_orders / dine_traffic。
 */
function storeNameToId(storeName) {
  const s = String(storeName || '');
  if (s.includes('马己仙')) return '51866138';
  if (s.includes('洪潮')) return '64822111';
  return '';
}

export { storeNameToId };

export async function fetchDineMetrics(pool, storeName, startDate, endDate) {
  const storeId = storeNameToId(storeName);
  const [posR, reportR] = await Promise.all([
    storeId
      ? pool.query(
          `SELECT COUNT(*)::int AS dine_orders,
            COALESCE(SUM(COALESCE(NULLIF(diners, 0), 1)), 0)::int AS dine_traffic,
            COALESCE(SUM(amount_before_discount), 0)::numeric AS dine_before_revenue
          FROM pos_orders
          WHERE store_id = $1 AND order_type = '堂食'
            AND biz_date >= $2 AND biz_date <= $3`,
          [storeId, startDate, endDate]
        )
      : Promise.resolve({ rows: [{}] }),
    pool.query(
      `SELECT COUNT(*)::int AS report_days,
        COALESCE(SUM(dine_orders), 0)::int AS dr_orders,
        COALESCE(SUM(dine_traffic), 0)::int AS dr_traffic,
        COALESCE(SUM(pre_discount_revenue), 0) - COALESCE(SUM(delivery_pre_revenue), 0) AS dr_dine_before_revenue
      FROM daily_reports
      WHERE store = $1 AND date >= $2 AND date <= $3`,
      [storeName, startDate, endDate]
    ),
  ]);

  const pos = posR.rows[0] || {};
  const dr = reportR.rows[0] || {};
  const posOrders = Number(pos.dine_orders || 0);
  const posTraffic = Number(pos.dine_traffic || 0);
  const posBefore = Number(pos.dine_before_revenue || 0);

  const dineBeforeRevenue = posBefore > 0 ? posBefore : Number(dr.dr_dine_before_revenue || 0);
  const dineOrders = posOrders > 0 ? posOrders : Number(dr.dr_orders || 0);
  const dineTraffic = posTraffic > 0 ? posTraffic : Number(dr.dr_traffic || 0);

  const avgTableSpend = dineOrders > 0 ? dineBeforeRevenue / dineOrders : 0;
  const avgSpendPerPerson = dineTraffic > 0 ? dineBeforeRevenue / dineTraffic : 0;

  return {
    dine_before_revenue: Math.round(dineBeforeRevenue),
    dine_orders: dineOrders,
    dine_traffic: dineTraffic,
    avg_table_spend: Math.round(avgTableSpend),
    avg_spend_per_person: Math.round(avgSpendPerPerson),
    report_days: Number(dr.report_days || 0),
    data_source: posBefore > 0 ? 'pos_orders' : 'daily_reports',
  };
}

/** 与 pos-stats 的 CURRENT_DATE - N days 窗口完全一致 */
export async function fetchDineMetricsForDays(pool, storeName, days) {
  const r = await pool.query(
    `SELECT (CURRENT_DATE - ($1::int || ' days')::interval)::date AS start_date,
            CURRENT_DATE::date AS end_date`,
    [days]
  );
  const row = r.rows[0] || {};
  return fetchDineMetrics(pool, storeName, row.start_date, row.end_date);
}

export function resolveStoreCanonicalName(sid) {
  const s = String(sid || '').trim();
  if (!s) return '';
  if (s === '64822111' || s.includes('洪潮')) return '洪潮大宁久光店';
  if (s === '51866138' || s.includes('马己仙')) return '马己仙上海音乐广场店';
  return s;
}
