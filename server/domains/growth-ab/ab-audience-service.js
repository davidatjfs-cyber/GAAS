/**
 * A/B 测试受众筛选与短信分组投放（从 growth-ab/service 外提）。
 */
import { cleanPhone, cleanText } from '../growth-phase-auth.js';
import { safeDateOnly, todayShanghaiYmd, ymdAddDays } from './dates.js';
import { interpolateAbContent, stableVariant } from './ab-metrics.js';

export async function listAbAudienceForSendDate(pool, storeCode, sendDate, lookbackDays = 7) {
  const store = cleanText(storeCode, 128);
  const sendYmd = safeDateOnly(sendDate);
  if (!store || !sendYmd) return [];
  const startYmd = ymdAddDays(sendYmd, -Math.max(1, Math.floor(Number(lookbackDays) || 7)));
  const r = await pool.query(
    `WITH base AS (
       SELECT gc.id AS customer_id,
              gc.phone,
              COALESCE(gcp.store_id, gc.last_store_id, '') AS store_code,
              COALESCE(NULLIF(gc.meta->>'title',''), NULLIF(gcp.source_signals->>'name',''), NULLIF(gc.meta->>'name',''), '') AS customer_name
       FROM growth_customers gc
       LEFT JOIN growth_customer_profiles gcp ON gcp.customer_id = gc.id
       WHERE COALESCE(gcp.store_id, gc.last_store_id, '') = $1
         AND gc.phone IS NOT NULL AND gc.phone <> ''
     ),
     hist AS (
       SELECT b.customer_id,
              b.phone,
              b.store_code,
              b.customer_name,
              MAX(po.biz_date) FILTER (WHERE po.biz_date < $2::date) AS last_order_before_send,
              COUNT(*) FILTER (WHERE po.biz_date >= $3::date AND po.biz_date < $2::date) AS orders_last_7d,
              COUNT(*) FILTER (WHERE po.biz_date < $2::date) AS lifetime_orders
       FROM base b
       LEFT JOIN pos_orders po
         ON (po.customer_id = b.customer_id OR (po.customer_id IS NULL AND po.phone = b.phone))
        AND po.store_id = $1
       GROUP BY b.customer_id, b.phone, b.store_code, b.customer_name
     )
     SELECT customer_id, phone, store_code, customer_name, last_order_before_send
     FROM hist
     WHERE orders_last_7d = 0
       AND lifetime_orders > 0
     ORDER BY COALESCE(last_order_before_send, DATE '1900-01-01') ASC, customer_id ASC`,
    [store, sendYmd, startYmd]
  );
  return r.rows || [];
}

export async function queueAbSmsAssignments(pool, taskRow, audienceRows, opts = {}, tenantId = 'default') {
  const taskId = Number(taskRow?.id || 0);
  if (!taskId || !Array.isArray(audienceRows) || !audienceRows.length) return { created: 0, audience: 0 };
  const storeCode = cleanText(taskRow?.store_code, 128);
  const sendDate = safeDateOnly(opts.sendDate || taskRow?.start_date) || todayShanghaiYmd();
  const variantA = taskRow?.variant_a && typeof taskRow.variant_a === 'object' ? taskRow.variant_a : {};
  const variantB = taskRow?.variant_b && typeof taskRow.variant_b === 'object' ? taskRow.variant_b : {};
  let created = 0;
  for (const row of audienceRows) {
    const customerId = Number(row?.customer_id || 0);
    const phone = cleanPhone(row?.phone);
    if (!customerId || !phone) continue;
    const variant = stableVariant(`${taskId}:${customerId}:${phone}`);
    const variantDef = variant === 'A' ? variantA : variantB;
    const content = interpolateAbContent(variantDef?.content || '', { name: row?.customer_name || '', phone });
    const deliveryKey = `abtest_${taskId}_${variant}_${customerId}`;
    const payload = {
      ab_test_id: taskId,
      variant,
      phone,
      customer_name: cleanText(row?.customer_name, 80),
      test_name: cleanText(taskRow?.test_name, 255),
      store_code: storeCode,
      target_metric: cleanText(taskRow?.target_metric, 80),
      sms_copy: content,
      coupon_offer: variant === 'A' ? '8折券' : '减8元券',
      audience_tag: '7日未到店',
      send_date: sendDate
    };
    const ins = await pool.query(
      `INSERT INTO growth_delivery_logs (
         delivery_key, action_key, rule_key, campaign_id, customer_id, store_id, channel,
         status, payload, result, created_at, updated_at, tenant_id
       ) VALUES ($1,$2,$3,$4,$5,$6,'sms','sent',$7::jsonb,$8::jsonb,$9::timestamptz,$9::timestamptz,$10)
       ON CONFLICT (delivery_key, tenant_id) DO NOTHING
       RETURNING id`,
      [
        deliveryKey,
        deliveryKey,
        `ab_test_${taskId}`,
        `ab_test_${taskId}`,
        customerId,
        storeCode,
        JSON.stringify(payload),
        JSON.stringify({ provider: 'internal_auto_seed', sent: true }),
        `${sendDate}T10:00:00+08:00`,
        tenantId
      ]
    );
    if (ins.rows?.length) created += 1;
  }
  return { created, audience: audienceRows.length };
}
