/**
 * A/B 测试结果落库与结果汇总计算（从 growth-ab/service 外提）。
 */
import { cleanText } from '../growth-phase-auth.js';
import { safeDateOnly, ymdAddDays } from './dates.js';
import { evalAbMetric } from './ab-metrics.js';

export async function upsertAbTaskResult(pool, row, tenantId = 'default') {
  await pool.query(
    `INSERT INTO ab_test_results (
       test_id, result_date, variant, sent, impressions, clicks,
       orders, redemptions, revenue, conversion_rate, tenant_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (test_id, result_date, variant) DO UPDATE SET
       sent = EXCLUDED.sent,
       impressions = EXCLUDED.impressions,
       clicks = EXCLUDED.clicks,
       orders = EXCLUDED.orders,
       redemptions = EXCLUDED.redemptions,
       revenue = EXCLUDED.revenue,
       conversion_rate = EXCLUDED.conversion_rate,
       created_at = NOW()`,
    [
      Number(row.test_id),
      safeDateOnly(row.result_date),
      cleanText(row.variant, 8),
      Math.max(0, Math.floor(Number(row.sent) || 0)),
      Math.max(0, Math.floor(Number(row.impressions) || 0)),
      Math.max(0, Math.floor(Number(row.clicks) || 0)),
      Math.max(0, Math.floor(Number(row.orders) || 0)),
      Math.max(0, Math.floor(Number(row.redemptions) || 0)),
      Number(Number(row.revenue || 0).toFixed(2)),
      Number(Number(row.conversion_rate || 0).toFixed(4)),
      tenantId
    ]
  );
}

export async function upsertAbTaskMetrics(pool, testId, resultDate, variant, metrics, tenantId = 'default') {
  const m = (metrics && typeof metrics === 'object') ? metrics : {};
  const num = (k) => Math.max(0, Number(m[k]) || 0);
  await pool.query(
    `INSERT INTO ab_test_results (
       test_id, result_date, variant, sent, clicks, redemptions, revenue, metrics_json, tenant_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     ON CONFLICT (test_id, result_date, variant) DO UPDATE SET
       sent = EXCLUDED.sent,
       clicks = EXCLUDED.clicks,
       redemptions = EXCLUDED.redemptions,
       revenue = EXCLUDED.revenue,
       metrics_json = EXCLUDED.metrics_json,
       created_at = NOW()`,
    [
      Number(testId), safeDateOnly(resultDate), (cleanText(variant, 8) === 'B' ? 'B' : 'A'),
      Math.floor(num('sent') || num('issued') || num('impressions') || num('views') || num('plays')),
      Math.floor(num('clicks') || num('interactions')),
      Math.floor(num('redemptions') || num('arrivals') || num('sold')),
      Number((num('revenue')).toFixed(2)),
      JSON.stringify(m),
      tenantId
    ]
  );
}

export async function refreshAbTestResults(pool, taskRow, tenantId = 'default') {
  const taskId = Number(taskRow?.id || 0);
  const storeCode = cleanText(taskRow?.store_code, 128);
  const startDate = safeDateOnly(taskRow?.start_date);
  const endDate = safeDateOnly(taskRow?.end_date);
  if (!taskId || !startDate || !endDate) return null;

  const deliveries = await pool.query(
    `SELECT customer_id,
            store_id,
            created_at,
            payload->>'variant' AS variant,
            payload->>'send_date' AS send_date
       FROM growth_delivery_logs
      WHERE channel = 'sms'
        AND payload->>'ab_test_id' = $1
        AND tenant_id = $2`,
    [String(taskId), tenantId]
  );
  const assignments = deliveries.rows || [];
  const sendCount = { A: 0, B: 0 };
  assignments.forEach((a) => {
    const v = cleanText(a.variant, 8) === 'B' ? 'B' : 'A';
    sendCount[v] += 1;
  });

  const assignmentMap = new Map();
  assignments.forEach((a) => {
    assignmentMap.set(Number(a.customer_id), cleanText(a.variant, 8) === 'B' ? 'B' : 'A');
  });

  const orderRes = await pool.query(
    `SELECT po.biz_date::text AS biz_date,
            po.customer_id,
            COUNT(*)::int AS order_count,
            COALESCE(SUM(po.amount_after_discount),0)::numeric AS revenue
       FROM pos_orders po
      WHERE po.store_id = $1
        AND po.customer_id IS NOT NULL
        AND po.biz_date >= $2::date
        AND po.biz_date <= $3::date
        AND po.customer_id = ANY($4::bigint[])
      GROUP BY po.biz_date, po.customer_id`,
    [storeCode, startDate, endDate, assignments.map((x) => Number(x.customer_id)).filter(Boolean)]
  );

  const byDateVariant = new Map();
  for (let cur = startDate; cur <= endDate; cur = ymdAddDays(cur, 1)) {
    ['A', 'B'].forEach((variant) => {
      byDateVariant.set(`${cur}|${variant}`, {
        test_id: taskId,
        result_date: cur,
        variant,
        sent: cur === startDate ? sendCount[variant] : 0,
        impressions: cur === startDate ? sendCount[variant] : 0,
        clicks: 0,
        orders: 0,
        redemptions: 0,
        revenue: 0,
        conversion_rate: 0
      });
    });
  }

  (orderRes.rows || []).forEach((row) => {
    const customerId = Number(row.customer_id || 0);
    const variant = assignmentMap.get(customerId);
    const key = `${safeDateOnly(row.biz_date)}|${variant}`;
    const slot = byDateVariant.get(key);
    if (!slot) return;
    slot.orders += Math.max(0, Math.floor(Number(row.order_count) || 0));
    slot.redemptions += 1;
    slot.revenue = Number((Number(slot.revenue || 0) + Number(row.revenue || 0)).toFixed(2));
    slot.conversion_rate = sendCount[variant] > 0 ? Number((slot.redemptions / sendCount[variant]).toFixed(4)) : 0;
  });

  for (const row of byDateVariant.values()) {
    await upsertAbTaskResult(pool, row, tenantId);
  }

  return { sendCount, assignments: assignments.length };
}

async function computeSchemaOutcome(pool, taskRow, schema, tenantId = 'default') {
  const taskId = Number(taskRow?.id || 0);
  const rows = await pool.query(
    `SELECT result_date, variant, metrics_json
       FROM ab_test_results WHERE test_id = $1 AND tenant_id = $2 ORDER BY result_date ASC, variant ASC`,
    [taskId, tenantId]
  );
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  const agg = { A: {}, B: {} };
  fields.forEach((f) => { agg.A[f.key] = 0; agg.B[f.key] = 0; });
  (rows.rows || []).forEach((r) => {
    const v = cleanText(r.variant, 8) === 'B' ? 'B' : 'A';
    const m = (r.metrics_json && typeof r.metrics_json === 'object') ? r.metrics_json : {};
    fields.forEach((f) => { agg[v][f.key] += Number(m[f.key] || 0); });
  });
  const primary = schema.primary || null;
  const extra = Array.isArray(schema.extra) ? schema.extra : [];
  const sampleField = (primary && primary.den) || (fields[0] && fields[0].key) || null;
  const byVariant = { A: {}, B: {} };
  ['A', 'B'].forEach((v) => {
    byVariant[v].raw = agg[v];
    byVariant[v].sample = sampleField ? Math.floor(Number(agg[v][sampleField] || 0)) : 0;
    byVariant[v].primary = primary ? evalAbMetric(agg[v], primary) : 0;
    byVariant[v].extras = extra.map((e) => ({ key: e.key, label: e.label, format: e.format, value: evalAbMetric(agg[v], e) }));
    byVariant[v].sent = byVariant[v].sample;
    byVariant[v].redemption_rate = primary && primary.format === 'pct' ? byVariant[v].primary : 0;
    byVariant[v].revenue = Number(agg[v].revenue || 0);
    byVariant[v].redemptions = Math.floor(Number(agg[v].redemptions || agg[v].arrivals || agg[v].sold || 0));
  });
  return { schema: { fields, primary, extra }, byVariant, daily: rows.rows || [] };
}

export async function computeAbTestOutcome(pool, taskRow, tenantId = 'default') {
  const taskId = Number(taskRow?.id || 0);
  if (!taskId) return null;
  const schema = (taskRow.metrics_schema && typeof taskRow.metrics_schema === 'object') ? taskRow.metrics_schema : null;
  if (schema && Array.isArray(schema.fields) && schema.fields.length) {
    return computeSchemaOutcome(pool, taskRow, schema, tenantId);
  }
  const isBound = !!cleanText(taskRow?.target_rule_key, 200);
  const sendCount = { A: 0, B: 0 };
  if (!isBound) {
    const deliveries = await pool.query(
      `SELECT customer_id, payload->>'variant' AS variant
         FROM growth_delivery_logs
        WHERE channel='sms' AND payload->>'ab_test_id' = $1 AND tenant_id = $2`,
      [String(taskId), tenantId]
    );
    (deliveries.rows || []).forEach((a) => {
      const v = cleanText(a.variant, 8) === 'B' ? 'B' : 'A';
      sendCount[v] += 1;
    });
  }
  const rows = await pool.query(
    `SELECT result_date, variant, sent, impressions, clicks, orders, redemptions, revenue, conversion_rate
       FROM ab_test_results
      WHERE test_id = $1 AND tenant_id = $2
      ORDER BY result_date ASC, variant ASC`,
    [taskId, tenantId]
  );
  const byVariant = {
    A: { sent: sendCount.A, impressions: 0, clicks: 0, orders: 0, redemptions: 0, revenue: 0 },
    B: { sent: sendCount.B, impressions: 0, clicks: 0, orders: 0, redemptions: 0, revenue: 0 }
  };
  (rows.rows || []).forEach((r) => {
    const v = cleanText(r.variant, 8) === 'B' ? 'B' : 'A';
    if (isBound) byVariant[v].sent += Math.max(0, Math.floor(Number(r.sent) || 0));
    byVariant[v].impressions += Math.max(0, Math.floor(Number(r.impressions) || 0));
    byVariant[v].clicks += Math.max(0, Math.floor(Number(r.clicks) || 0));
    byVariant[v].orders += Math.max(0, Math.floor(Number(r.orders) || 0));
    byVariant[v].redemptions += Math.max(0, Math.floor(Number(r.redemptions) || 0));
    byVariant[v].revenue = Number((byVariant[v].revenue + Number(r.revenue || 0)).toFixed(2));
  });
  ['A', 'B'].forEach((v) => {
    byVariant[v].redemption_rate = byVariant[v].sent > 0 ? Number((byVariant[v].redemptions / byVariant[v].sent).toFixed(4)) : 0;
    byVariant[v].revenue_per_order = byVariant[v].orders > 0 ? Number((byVariant[v].revenue / byVariant[v].orders).toFixed(2)) : 0;
  });
  return { daily: rows.rows || [], byVariant, sendCount };
}
