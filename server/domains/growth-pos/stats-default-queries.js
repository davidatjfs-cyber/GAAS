/**
 * Default POS stats SQL bundles — P5.4 split from getDefaultPosStats.
 */

export async function queryDefaultPosStatsCore(pool, { posCond, itemsCond: _itemsCond, reportStoreCond, statsParams }) {
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
  return { summaryR, storeR, hourR, payR, dishR, repeatR, reportSummaryR };
}

export async function queryDefaultPosStatsDetail(pool, { posCond, itemsCond, statsParams }) {
  const [
    byOrderTypeR, byOrderSourceR, byDeptR, periodProfileR, spendDistR, visitR, dishCatR, custOrderTypeR, custOrderSourceR, custDeptR,
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
  return { byOrderTypeR, byOrderSourceR, byDeptR, periodProfileR, spendDistR, visitR, dishCatR, custOrderTypeR, custOrderSourceR, custDeptR };
}
