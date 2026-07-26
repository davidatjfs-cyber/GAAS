/**
 * 客户画像重算（从 growth-api.js 外提）。生命周期/价值分级 SQL 落此模块。
 * 大段 SQL 放模块级常量，避免 function-size 扫描器把 jsonb `'{}'` 误判为函数嵌套。
 */

const AUTO_ENROLL_POS_CUSTOMERS_SQL = `
    INSERT INTO growth_customers (phone, first_store_id, last_store_id, first_seen_at, last_seen_at, meta, tenant_id)
    SELECT s.phone, s.first_store, s.last_store, s.first_at, s.last_at, '{"source":"pos_auto"}'::jsonb, $1
    FROM (
      SELECT phone,
             (ARRAY_AGG(NULLIF(store_id,'') ORDER BY biz_date ASC) FILTER (WHERE NULLIF(store_id,'') IS NOT NULL))[1] AS first_store,
             (ARRAY_AGG(NULLIF(store_id,'') ORDER BY biz_date DESC) FILTER (WHERE NULLIF(store_id,'') IS NOT NULL))[1] AS last_store,
             MIN(biz_date)::timestamptz AS first_at,
             MAX(biz_date)::timestamptz AS last_at
      FROM pos_orders
      WHERE phone IS NOT NULL AND phone <> '' AND tenant_id = $1
      GROUP BY phone
    ) s
    ON CONFLICT (phone, tenant_id) WHERE phone IS NOT NULL AND phone <> '' DO NOTHING
  `;

const UPSERT_PROFILES_SQL = `WITH event_base AS (
       SELECT
         c.id AS customer_id,
         c.phone,
         c.openid,
         COALESCE(c.last_store_id, c.first_store_id, '') AS store_id,
         MAX(e.occurred_at) AS last_event_at,
         COUNT(*) FILTER (WHERE e.event_type = 'payment_success')::int AS payment_count,
         COUNT(*) FILTER (WHERE e.event_type IN ('coupon_claimed','coupon_purchased','marketing_triggered'))::int AS discount_touch_count,
         COUNT(*) FILTER (WHERE e.event_type = 'coupon_redeemed')::int AS discount_convert_count,
         AVG(NULLIF((e.metadata ->> 'party_size')::numeric, 0)) FILTER (WHERE e.metadata ? 'party_size') AS avg_party_size,
         AVG(NULLIF((e.metadata ->> 'spicy_level')::numeric, 0)) FILTER (WHERE e.metadata ? 'spicy_level') AS spicy_level,
         MODE() WITHIN GROUP (ORDER BY CASE
           WHEN EXTRACT(HOUR FROM e.occurred_at) BETWEEN 10 AND 14 THEN '午市'
           WHEN EXTRACT(HOUR FROM e.occurred_at) BETWEEN 17 AND 21 THEN '晚市'
           ELSE '夜间'
         END) AS preferred_visit_time
       FROM growth_customers c
       LEFT JOIN growth_events e ON e.customer_id = c.id
         AND e.occurred_at >= CURRENT_DATE - ($1::int || ' days')::interval
       WHERE c.tenant_id = $2
       GROUP BY c.id, c.phone, c.openid, COALESCE(c.last_store_id, c.first_store_id, '')
     ), signal_base AS (
       SELECT
         s.customer_id,
         AVG(s.signal_score) FILTER (WHERE s.signal_key = 'price_sensitivity') AS signal_price_sensitivity,
         AVG(s.signal_score) FILTER (WHERE s.signal_key = 'adventurous_score') AS adventurous_score,
         AVG(s.signal_score) FILTER (WHERE s.signal_key = 'health_conscious_score') AS health_conscious_score,
         AVG(s.signal_score) FILTER (WHERE s.signal_key = 'response_to_discount') AS response_to_discount,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'date')::numeric AS occasion_date_score,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'family')::numeric AS occasion_family_score,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'business')::numeric AS occasion_business_score,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'solo')::numeric AS occasion_solo_score,
         COUNT(*) FILTER (WHERE s.signal_key = 'occasion' AND s.signal_value = 'friends')::numeric AS occasion_friends_score,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.signal_value) FILTER (WHERE s.signal_key = 'favorite_dish' AND COALESCE(s.signal_value,'') <> ''), NULL) AS favorite_dishes,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT s.signal_value) FILTER (WHERE s.signal_type = 'semantic_tag' AND COALESCE(s.signal_value,'') <> ''), NULL) AS semantic_tags
        FROM growth_profile_signals s
        WHERE s.occurred_at >= CURRENT_DATE - ($1::int || ' days')::interval
        GROUP BY s.customer_id
      ), pos_order_base AS (
        SELECT
          gc.id AS customer_id,
          COUNT(DISTINCT po.order_no)::int AS pos_order_count,
          COALESCE(SUM(po.amount_after_discount), 0) AS pos_total_spend,
          COALESCE(SUM(po.amount_before_discount), 0) AS pos_total_before_spend,
          COALESCE(SUM(COALESCE(NULLIF(po.diners, 0), 1)), 0) AS pos_total_diners,
          ROUND(SUM(po.amount_before_discount) / NULLIF(SUM(COALESCE(NULLIF(po.diners, 0), 1)), 0), 2) AS avg_check,
          COUNT(*) FILTER (WHERE po.order_type = '堂食')::numeric / NULLIF(COUNT(*)::numeric, 0) AS pos_dine_in_ratio,
          MAX(po.biz_date) AS pos_last_order_at
        FROM growth_customers gc
        INNER JOIN pos_orders po ON gc.phone = po.phone AND po.phone <> ''
        WHERE gc.tenant_id = $2
        GROUP BY gc.id
      ), pos_dish_base AS (
        SELECT
          gc.id AS customer_id,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT poi.dish_name) FILTER (WHERE poi.dish_name IS NOT NULL AND poi.dish_name <> '-' AND poi.category <> '-'), NULL) AS pos_favorite_dishes
        FROM growth_customers gc
        INNER JOIN pos_orders po ON gc.phone = po.phone AND po.phone <> ''
        INNER JOIN pos_order_items poi ON poi.order_no = po.order_no AND poi.category IS NOT NULL AND poi.category <> '-'
        WHERE gc.tenant_id = $2
        GROUP BY gc.id
      ), pos_base AS (
        SELECT
          pob.*,
          COALESCE(pdb.pos_favorite_dishes, '{}') AS pos_favorite_dishes
        FROM pos_order_base pob
        LEFT JOIN pos_dish_base pdb ON pdb.customer_id = pob.customer_id
      )
      INSERT INTO growth_customer_profiles (
        customer_id, phone, openid, store_id, lifecycle_stage,
        next_visit_probability, best_contact_window, preferred_visit_time,
        avg_party_size, response_to_discount, price_sensitivity,
        adventurous_score, health_conscious_score, spicy_level,
        occasion_date_score, occasion_family_score, occasion_business_score,
        occasion_solo_score, occasion_friends_score,
        favorite_dishes, semantic_tags, source_signals, last_profiled_at, updated_at,
        pos_order_count, pos_total_spend, avg_check, pos_dine_in_ratio, pos_last_order_at, tenant_id
      )
     SELECT
       e.customer_id,
       e.phone,
       e.openid,
       NULLIF(e.store_id, ''),
        CASE
          WHEN GREATEST(e.payment_count, COALESCE(p.pos_order_count, 0)) = 0 THEN 'prospect'
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '14 days'
               AND GREATEST(e.payment_count, COALESCE(p.pos_order_count, 0)) = 1 THEN 'new'
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '14 days'
               AND GREATEST(e.payment_count, COALESCE(p.pos_order_count, 0)) >= 2 THEN 'active'
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '30 days' THEN 'at_risk'
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) < NOW() - INTERVAL '365 days' THEN 'lost_365'
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) < NOW() - INTERVAL '180 days' THEN 'lost_180'
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) < NOW() - INTERVAL '90 days' THEN 'lost_90'
          WHEN GREATEST(e.payment_count, COALESCE(p.pos_order_count, 0)) >= 2 THEN 'dormant'
          ELSE 'churned'
        END,
        CASE
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '7 days' THEN 0.85
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '14 days' THEN 0.65
          WHEN GREATEST(e.last_event_at, p.pos_last_order_at) >= NOW() - INTERVAL '30 days' THEN 0.35
          ELSE 0.1
        END,
       CASE COALESCE(e.preferred_visit_time, '晚市')
         WHEN '午市' THEN '周四 11:00-13:00'
         WHEN '夜间' THEN '周五 20:00-22:00'
         ELSE '周五 17:00-19:00'
       END,
       COALESCE(e.preferred_visit_time, '晚市'),
       COALESCE(e.avg_party_size, 1),
       COALESCE(s.response_to_discount,
         CASE WHEN e.discount_touch_count > 0 THEN ROUND(e.discount_convert_count::numeric / e.discount_touch_count, 4) ELSE 0 END),
       COALESCE(s.signal_price_sensitivity,
         CASE WHEN e.discount_touch_count > 0 THEN ROUND(LEAST(1, e.discount_convert_count::numeric / e.discount_touch_count), 4) ELSE 0.2 END),
       COALESCE(s.adventurous_score, 0.5),
       COALESCE(s.health_conscious_score, 0.5),
       COALESCE(e.spicy_level, 0.5),
       COALESCE(s.occasion_date_score, 0),
       COALESCE(s.occasion_family_score, 0),
       COALESCE(s.occasion_business_score, 0),
       COALESCE(s.occasion_solo_score, 0),
       COALESCE(s.occasion_friends_score, 0),
        COALESCE(to_jsonb(ARRAY(SELECT DISTINCT unnest(COALESCE(s.favorite_dishes, '{}') || COALESCE(p.pos_favorite_dishes, '{}')))), '[]'::jsonb),
        COALESCE(to_jsonb(s.semantic_tags), '[]'::jsonb),
        jsonb_build_object(
          'payment_count', e.payment_count,
          'discount_touch_count', e.discount_touch_count,
          'discount_convert_count', e.discount_convert_count,
          'pos_order_count', COALESCE(p.pos_order_count, 0),
          'pos_total_spend', COALESCE(p.pos_total_spend, 0),
          'pos_total_before_spend', COALESCE(p.pos_total_before_spend, 0),
          'pos_total_diners', COALESCE(p.pos_total_diners, 0),
          'source_days', $1
        ),
        NOW(), NOW(),
        COALESCE(p.pos_order_count, 0),
        COALESCE(p.pos_total_spend, 0),
        COALESCE(p.avg_check, ROUND(e.avg_party_size, 2)),
        p.pos_dine_in_ratio,
        p.pos_last_order_at,
        $2
      FROM event_base e
      LEFT JOIN signal_base s ON s.customer_id = e.customer_id
      LEFT JOIN pos_base p ON p.customer_id = e.customer_id
      ON CONFLICT (customer_id, tenant_id) DO UPDATE SET
        phone = EXCLUDED.phone,
        openid = EXCLUDED.openid,
        store_id = EXCLUDED.store_id,
        lifecycle_stage = EXCLUDED.lifecycle_stage,
        next_visit_probability = EXCLUDED.next_visit_probability,
        best_contact_window = EXCLUDED.best_contact_window,
        preferred_visit_time = EXCLUDED.preferred_visit_time,
        avg_party_size = EXCLUDED.avg_party_size,
        response_to_discount = EXCLUDED.response_to_discount,
        price_sensitivity = EXCLUDED.price_sensitivity,
        adventurous_score = EXCLUDED.adventurous_score,
        health_conscious_score = EXCLUDED.health_conscious_score,
        spicy_level = EXCLUDED.spicy_level,
        occasion_date_score = EXCLUDED.occasion_date_score,
        occasion_family_score = EXCLUDED.occasion_family_score,
        occasion_business_score = EXCLUDED.occasion_business_score,
        occasion_solo_score = EXCLUDED.occasion_solo_score,
        occasion_friends_score = EXCLUDED.occasion_friends_score,
        favorite_dishes = EXCLUDED.favorite_dishes,
        semantic_tags = EXCLUDED.semantic_tags,
        source_signals = EXCLUDED.source_signals,
        pos_order_count = EXCLUDED.pos_order_count,
        pos_total_spend = EXCLUDED.pos_total_spend,
        avg_check = EXCLUDED.avg_check,
        pos_dine_in_ratio = EXCLUDED.pos_dine_in_ratio,
        pos_last_order_at = EXCLUDED.pos_last_order_at,
        last_profiled_at = NOW(),
        updated_at = NOW()`;

const UPDATE_VALUE_TIER_SQL = `
    WITH customer_avg AS (
      SELECT
        customer_id,
        COALESCE(NULLIF(store_id, ''), '*') AS store_id,
        COALESCE(
          NULLIF(avg_check, 0),
          COALESCE((source_signals ->> 'pos_total_before_spend')::numeric, pos_total_spend)
            / NULLIF(COALESCE((source_signals ->> 'pos_total_diners')::numeric, 0), 0)
        ) AS avg_spend_per_person
      FROM growth_customer_profiles
      WHERE COALESCE(pos_total_spend, 0) > 0
    ), ranked AS (
      SELECT
        customer_id,
        PERCENT_RANK() OVER (
          PARTITION BY store_id
          ORDER BY avg_spend_per_person DESC, customer_id
        ) AS spend_pct
      FROM customer_avg
      WHERE avg_spend_per_person IS NOT NULL AND avg_spend_per_person > 0
    )
    UPDATE growth_customer_profiles p
      SET value_tier = CASE
          WHEN r.spend_pct <= 0.15 THEN 'vip'
          WHEN r.spend_pct <= 0.50 THEN 'regular'
          ELSE 'low'
        END
    FROM ranked r
    WHERE p.customer_id = r.customer_id
  `;

const UPDATE_PRICE_SENSITIVE_SQL = `
    UPDATE growth_customer_profiles
    SET price_sensitive = (COALESCE(price_sensitivity, 0) > 0.5 OR COALESCE(response_to_discount, 0) > 0.4)
  `;

export async function autoEnrollPosCustomersFromOrders(pool, tenantId = 'default') {
  await pool.query(AUTO_ENROLL_POS_CUSTOMERS_SQL, [tenantId]);
}

export async function upsertCustomerProfilesFromSignals(pool, safeDays, tenantId = 'default') {
  await pool.query(UPSERT_PROFILES_SQL, [safeDays, tenantId]);
}

export async function updateProfileValueTiers(pool) {
  await pool.query(UPDATE_VALUE_TIER_SQL);
  await pool.query(`UPDATE growth_customer_profiles SET value_tier = 'low' WHERE COALESCE(pos_total_spend, 0) = 0`);
}

export async function updateProfilePriceSensitiveFlags(pool) {
  await pool.query(UPDATE_PRICE_SENSITIVE_SQL);
}

export async function recomputeCustomerProfiles(pool, days = 90, tenantId = 'default') {
  const safeDays = clampProfileRecomputeDays(days);
  await autoEnrollPosCustomersFromOrders(pool, tenantId);
  await upsertCustomerProfilesFromSignals(pool, safeDays, tenantId);
  await updateProfileValueTiers(pool);
  await updateProfilePriceSensitiveFlags(pool);
  return safeDays;
}

/** Clamp days window for profile recompute (pure). */
export function clampProfileRecomputeDays(days) {
  return Math.min(Math.max(Number(days) || 90, 7), 365);
}
