/**
 * Real Data Sync — 把生产真实业务表映射进 growth_ontology_* 影子schema
 *
 * 背景：growth_ontology_* 这套表之前只被 server/scripts/seed-growth-demo.js（e2e造假数据脚本）写过，
 * 从未接入真实数据，导致诊断/机会/归因全部因为查不到数据而返回 insufficient_data。
 * 本模块是唯一的真实数据写入路径，按 diagnosis-tree-service.js 实际读取的字段做映射：
 *   growth_ontology_stores      <- stores
 *   growth_ontology_employees   <- employees
 *   growth_ontology_customers   <- growth_customer_profiles，聚合字段用 pos_orders 按 phone 重新算，
 *                                  比 growth_customer_profiles 里可能过期的缓存字段更准
 *   growth_ontology_orders      <- pos_orders（近400天，覆盖 90-180 天沉睡客户判断窗口 + 冗余）
 *   growth_ontology_campaigns   <- marketing_campaigns
 *   growth_ontology_touches     <- growth_delivery_logs（status=sent/redeemed，近400天；
 *                                  用 payload.phone 关联 growth_customer_profiles 得到客户，
 *                                  store_id 经 store_name_aliases 规整）
 *
 * 门店ID统一走 store_name_aliases 表规整成 canonical_name（stores.name / pos_orders.store_id /
 * growth_customer_profiles.store_id / employees.store / growth_delivery_logs.store_id 格式不一，
 * 这张表是唯一的对齐口径，见 CLAUDE.md 和 knowledge-graph.js#getStoreAliases 的既有约定）。
 *
 * 若 delivery_logs 无法解析出客户（无 phone / 无 profile），该条触达不同步——诊断侧会在
 * marketing.touched=0 时标记 dataGaps.marketing_touches，而不是假装算过转化率。
 */

import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'ontology', handler: 'real-data-sync' });

const ALIAS_MAP_CTE = `
  alias_map AS (
    SELECT alias_name, canonical_name FROM store_name_aliases WHERE tenant_id = $1 AND enabled = true
  )
`;

export async function syncOntologyDataFromProduction(pool, tenantId = 'default') {
  const result = { stores: 0, employees: 0, customers: 0, orders: 0, campaigns: 0, touches: 0 };

  const storesR = await pool.query(
    `WITH ${ALIAS_MAP_CTE}
     INSERT INTO growth_ontology_stores (store_id, tenant_id, name, city, status, updated_at)
     SELECT COALESCE(am.canonical_name, s.name), $1, s.name, s.city,
            CASE WHEN s.is_active THEN 'active' ELSE 'inactive' END, now()
       FROM stores s
       LEFT JOIN alias_map am ON am.alias_name = s.name
     ON CONFLICT (tenant_id, store_id) DO UPDATE SET
       name = EXCLUDED.name, city = EXCLUDED.city, status = EXCLUDED.status, updated_at = now()`,
    [tenantId]
  );
  result.stores = storesR.rowCount || 0;

  const employeesR = await pool.query(
    `WITH ${ALIAS_MAP_CTE}
     INSERT INTO growth_ontology_employees (employee_id, tenant_id, store_id, name, role, status, updated_at)
     SELECT e.username, $1, COALESCE(am.canonical_name, e.store), e.name, e.role, e.status, now()
       FROM employees e
       LEFT JOIN alias_map am ON am.alias_name = e.store
      WHERE e.tenant_id = $1
     ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
       store_id = EXCLUDED.store_id, name = EXCLUDED.name, role = EXCLUDED.role,
       status = EXCLUDED.status, updated_at = now()`,
    [tenantId]
  );
  result.employees = employeesR.rowCount || 0;

  const customersR = await pool.query(
    `WITH ${ALIAS_MAP_CTE},
     order_agg AS (
       SELECT COALESCE(am.canonical_name, po.store_id::text) AS store_id,
              po.phone,
              min(COALESCE(po.checkout_time, po.order_time)) AS first_visit_at,
              max(COALESCE(po.checkout_time, po.order_time)) AS last_visit_at,
              count(*)::numeric AS visit_count,
              sum(po.amount_after_discount)::numeric AS total_spend
         FROM pos_orders po
         LEFT JOIN alias_map am ON am.alias_name = po.store_id::text
        WHERE po.tenant_id = $1 AND po.phone IS NOT NULL AND po.phone <> ''
        GROUP BY 1, 2
     )
     INSERT INTO growth_ontology_customers (
       customer_id, tenant_id, store_id, phone, first_visit_at, last_visit_at,
       visit_count, total_spend, avg_spend, lifecycle_stage, risk_level, value_level, updated_at
     )
     SELECT
       'gcp_' || gcp.customer_id::text,
       $1,
       COALESCE(am2.canonical_name, gcp.store_id),
       gcp.phone,
       oa.first_visit_at,
       COALESCE(oa.last_visit_at, gcp.pos_last_order_at),
       COALESCE(oa.visit_count, gcp.pos_order_count, 0),
       COALESCE(oa.total_spend, gcp.pos_total_spend, 0),
       CASE WHEN COALESCE(oa.visit_count, 0) > 0 THEN oa.total_spend / oa.visit_count ELSE COALESCE(gcp.avg_check, 0) END,
       gcp.lifecycle_stage,
       CASE WHEN COALESCE(oa.last_visit_at, gcp.pos_last_order_at) < now() - interval '90 days' THEN 'sleeping' ELSE 'normal' END,
       gcp.value_tier,
       now()
     FROM growth_customer_profiles gcp
     LEFT JOIN alias_map am2 ON am2.alias_name = gcp.store_id
     LEFT JOIN order_agg oa ON oa.store_id = COALESCE(am2.canonical_name, gcp.store_id) AND oa.phone = gcp.phone
     WHERE gcp.tenant_id = $1
     ON CONFLICT (tenant_id, customer_id) DO UPDATE SET
       store_id = EXCLUDED.store_id, phone = EXCLUDED.phone,
       first_visit_at = EXCLUDED.first_visit_at, last_visit_at = EXCLUDED.last_visit_at,
       visit_count = EXCLUDED.visit_count, total_spend = EXCLUDED.total_spend, avg_spend = EXCLUDED.avg_spend,
       lifecycle_stage = EXCLUDED.lifecycle_stage, risk_level = EXCLUDED.risk_level,
       value_level = EXCLUDED.value_level, updated_at = now()`,
    [tenantId]
  );
  result.customers = customersR.rowCount || 0;

  const ordersR = await pool.query(
    `WITH ${ALIAS_MAP_CTE}
     INSERT INTO growth_ontology_orders (
       order_id, tenant_id, store_id, customer_id, order_time, amount, discount_amount,
       actual_paid, pax, channel, source, updated_at
     )
     SELECT
       po.store_id::text || ':' || po.order_no,
       $1,
       COALESCE(am.canonical_name, po.store_id::text),
       CASE WHEN gcp.customer_id IS NOT NULL THEN 'gcp_' || gcp.customer_id::text END,
       COALESCE(po.checkout_time, po.order_time),
       po.amount_before_discount,
       po.amount_before_discount - po.amount_after_discount,
       po.amount_after_discount,
       po.diners,
       po.order_type,
       'pos',
       now()
     FROM pos_orders po
     LEFT JOIN alias_map am ON am.alias_name = po.store_id::text
     LEFT JOIN growth_customer_profiles gcp ON gcp.tenant_id = $1 AND gcp.phone = po.phone AND po.phone <> ''
     WHERE po.tenant_id = $1 AND COALESCE(po.checkout_time, po.order_time) >= now() - interval '400 days'
     ON CONFLICT (tenant_id, order_id) DO UPDATE SET
       store_id = EXCLUDED.store_id, customer_id = EXCLUDED.customer_id, order_time = EXCLUDED.order_time,
       amount = EXCLUDED.amount, discount_amount = EXCLUDED.discount_amount, actual_paid = EXCLUDED.actual_paid,
       pax = EXCLUDED.pax, channel = EXCLUDED.channel, updated_at = now()`,
    [tenantId]
  );
  result.orders = ordersR.rowCount || 0;

  const campaignsR = await pool.query(
    `WITH ${ALIAS_MAP_CTE}
     INSERT INTO growth_ontology_campaigns (
       campaign_id, tenant_id, store_id, name, channel, offer_type, offer_cost_estimate,
       start_at, end_at, status, updated_at
     )
     SELECT
       mc.id::text, $1,
       COALESCE(am.canonical_name, mc.store),
       mc.title, mc.channel, mc.campaign_type, mc.budget,
       mc.planned_date::timestamptz, mc.planned_end_date::timestamptz, mc.status, now()
       FROM marketing_campaigns mc
       LEFT JOIN alias_map am ON am.alias_name = mc.store
      WHERE mc.tenant_id = $1
     ON CONFLICT (tenant_id, campaign_id) DO UPDATE SET
       store_id = EXCLUDED.store_id, name = EXCLUDED.name, channel = EXCLUDED.channel,
       offer_type = EXCLUDED.offer_type, offer_cost_estimate = EXCLUDED.offer_cost_estimate,
       start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, status = EXCLUDED.status, updated_at = now()`,
    [tenantId]
  );
  result.campaigns = campaignsR.rowCount || 0;

  // 历史日志常把手机号只写在 payload.phone；先回填到 phone 列再 JOIN，避免表达式扫全表过慢。
  await pool.query(
    `UPDATE growth_delivery_logs
        SET phone = payload->>'phone'
      WHERE tenant_id = $1
        AND (phone IS NULL OR phone = '')
        AND payload->>'phone' IS NOT NULL
        AND payload->>'phone' <> ''`,
    [tenantId]
  ).catch((e) => log.warn({ msg: 'phone_backfill_skipped', err: e?.message || String(e) }));

  // 只同步能落到 ontology 客户 ID 的触达：marketingStats 用 customer_id DISTINCT 计数，
  // 无客户 ID 的行进表也计不进 touched，白占空间。
  const touchesR = await pool.query(
    `WITH ${ALIAS_MAP_CTE}
     INSERT INTO growth_ontology_touches (
       touch_id, tenant_id, store_id, customer_id, campaign_id, channel, content,
       coupon_id, sent_at, status, updated_at
     )
     SELECT
       'dl_' || COALESCE(NULLIF(dl.delivery_key, ''), dl.id::text),
       $1,
       COALESCE(am.canonical_name, NULLIF(dl.store_id, ''), gcp_store.canonical_name, gcp.store_id),
       'gcp_' || gcp.customer_id::text,
       COALESCE(
         NULLIF(dl.campaign_id, ''),
         NULLIF(dl.payload->>'campaign_id', ''),
         NULLIF(dl.rule_key, ''),
         NULLIF(dl.action_key, '')
       ),
       COALESCE(NULLIF(dl.channel, ''), 'unknown'),
       COALESCE(dl.action_key, dl.rule_key, ''),
       COALESCE(NULLIF(dl.coupon_id, ''), NULLIF(dl.payload->>'coupon_code', '')),
       dl.created_at,
       dl.status,
       now()
     FROM growth_delivery_logs dl
     LEFT JOIN alias_map am ON am.alias_name = dl.store_id
     INNER JOIN growth_customer_profiles gcp
       ON gcp.tenant_id = $1
      AND gcp.phone = COALESCE(NULLIF(dl.phone, ''), NULLIF(dl.payload->>'phone', ''))
     LEFT JOIN alias_map gcp_store ON gcp_store.alias_name = gcp.store_id
     WHERE dl.tenant_id = $1
       AND dl.status IN ('sent', 'redeemed')
       AND dl.created_at >= now() - interval '400 days'
       AND COALESCE(NULLIF(dl.phone, ''), NULLIF(dl.payload->>'phone', '')) IS NOT NULL
       AND COALESCE(NULLIF(dl.phone, ''), NULLIF(dl.payload->>'phone', '')) <> ''
     ON CONFLICT (tenant_id, touch_id) DO UPDATE SET
       store_id = EXCLUDED.store_id,
       customer_id = EXCLUDED.customer_id,
       campaign_id = EXCLUDED.campaign_id,
       channel = EXCLUDED.channel,
       content = EXCLUDED.content,
       coupon_id = EXCLUDED.coupon_id,
       sent_at = EXCLUDED.sent_at,
       status = EXCLUDED.status,
       updated_at = now()`,
    [tenantId]
  );
  result.touches = touchesR.rowCount || 0;

  return result;
}
