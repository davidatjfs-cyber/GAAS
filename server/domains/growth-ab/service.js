/**
 * 增长 A/B 测试、经验库、定价测试 — 业务逻辑（从 growth-phases 外提）。
 */
import { callLLM } from '../../agents.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import { checkTextGrounding } from '../../ontology/plan-grounding-check.js';
import { cleanPhone, cleanText } from '../growth-phase-auth.js';
import { AB_TEMPLATES, getAbTemplate } from './ab-templates.js';
import { safeDateOnly, todayShanghaiYmd, ymdAddDays } from './dates.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'growth-ab', handler: 'service' });


export { AB_TEMPLATES, getAbTemplate } from './ab-templates.js';
export { safeDateOnly, todayShanghaiYmd, ymdAddDays } from './dates.js';

function httpError(code, status = 400, message = '') {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

export function sanitizeMetricDef(m, allowedKeys) {
  if (!m || typeof m !== 'object') return null;
  const num = Array.isArray(m.num) ? m.num.map((k) => cleanText(k, 40)).filter((k) => allowedKeys.includes(k)) : [];
  if (!num.length) return null;
  const den = m.den ? cleanText(m.den, 40) : null;
  if (den && !allowedKeys.includes(den)) return null;
  const fmt = ['pct', 'money', 'x', 'int'].includes(m.format) ? m.format : (den ? 'pct' : 'int');
  return { key: cleanText(m.key || 'primary', 40), label: cleanText(m.label || '主指标', 40), num, den, format: fmt };
}

export function sanitizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.map((f) => ({
    key: cleanText(f.key || f.label, 40).replace(/[^a-zA-Z0-9_]/g, '') || ('f' + Math.random().toString(36).slice(2, 7)),
    label: cleanText(f.label || f.key, 40),
    type: ['int', 'money'].includes(f.type) ? f.type : 'int'
  })).filter((f) => f.key && f.label).slice(0, 12);
}

export function evalAbMetric(agg, def) {
  if (!def) return 0;
  const num = (def.num || []).reduce((s, k) => s + Number(agg[k] || 0), 0);
  if (!def.den) return Number(num.toFixed(2));
  const den = Number(agg[def.den] || 0);
  if (den <= 0) return 0;
  const v = num / den;
  return def.format === 'pct' ? Number(v.toFixed(4)) : Number(v.toFixed(2));
}

export function stableVariant(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h) % 2 === 0 ? 'A' : 'B';
}

export function interpolateAbContent(template, customer) {
  const name = cleanText(customer?.name || customer?.member_name || '', 40) || '您';
  return String(template || '').replace(/\{姓名\}/g, name).replace(/\{name\}/gi, name);
}

export function formatPercent(n, digits = 2) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0.00%';
  return `${v.toFixed(digits)}%`;
}

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

async function upsertAbTaskResult(pool, row, tenantId = 'default') {
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

async function upsertAbTaskMetrics(pool, testId, resultDate, variant, metrics, tenantId = 'default') {
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

export async function loadAbBoundRule(pool, kind, ruleKey) {
  const key = cleanText(ruleKey, 200);
  if (!key) return null;
  if (kind === 'payment_rule') {
    const r = await pool.query(`SELECT * FROM marketing_payment_rules WHERE rule_key = $1 LIMIT 1`, [key]);
    if (!r.rows?.length) return null;
    const row = r.rows[0];
    return {
      kind: 'payment_rule',
      rule: row,
      variant_a: {
        label: '当前版本(A)',
        rule_key: row.rule_key,
        name: cleanText(row.name, 255),
        template_id: cleanText(row.member_template_id, 128),
        trigger_value: String(row.trigger_value == null ? '' : row.trigger_value),
        content: cleanText(row.name, 255)
      }
    };
  }
  const r = await pool.query(`SELECT * FROM growth_touch_rules WHERE rule_key = $1 LIMIT 1`, [key]);
  if (!r.rows?.length) return null;
  const row = r.rows[0];
  const ap = (row.action_payload && typeof row.action_payload === 'object') ? row.action_payload : {};
  return {
    kind: 'touch_rule',
    rule: row,
    variant_a: {
      label: '当前版本(A)',
      rule_key: row.rule_key,
      name: cleanText(row.name, 255),
      content: cleanText(ap.content_template || ap.template_text || '', 2000),
      coupon_value: ap.coupon_value != null ? Number(ap.coupon_value) : (ap.value != null ? Number(ap.value) : null)
    }
  };
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

async function buildAbAiSummary(taskRow, outcome) {
  const byVariant = outcome?.byVariant || {};
  const a = byVariant.A || {};
  const b = byVariant.B || {};
  const prompt = `你是餐饮增长分析助手。请用简洁中文总结一次A/B测试结果，输出1段话，不要分点，不超过180字。\n测试名：${taskRow.test_name}\n目标指标：${taskRow.target_metric}\nA组发送${a.sent || 0}人，核销/回流${a.redemptions || 0}，核销率${formatPercent((a.redemption_rate || 0) * 100)}，营收${a.revenue || 0}元。\nB组发送${b.sent || 0}人，核销/回流${b.redemptions || 0}，核销率${formatPercent((b.redemption_rate || 0) * 100)}，营收${b.revenue || 0}元。`;
  try {
    const llm = await callLLM([{ role: 'user', content: prompt }], { purpose: 'data_analysis', temperature: 0.2, max_tokens: 220 });
    if (llm?.ok && llm.content) {
      const known = [a.sent, a.redemptions, b.sent, b.redemptions, a.revenue, b.revenue].map(Number).filter(Number.isFinite);
      const grounding = checkTextGrounding(llm.content, known);
      if (grounding.passed) return cleanText(llm.content, 1800);
    }
  } catch (_) { /* ignore */ }
  const winner = (a.redemption_rate || 0) > (b.redemption_rate || 0) ? 'A' : (a.redemption_rate || 0) < (b.redemption_rate || 0) ? 'B' : 'tie';
  return cleanText(`测试完成：A组核销率${formatPercent((a.redemption_rate || 0) * 100)}，B组核销率${formatPercent((b.redemption_rate || 0) * 100)}，${winner === 'tie' ? '两组差异不明显，建议继续积累样本。' : `${winner}组表现更好，建议将该版本作为下轮默认文案。`}`, 1800);
}

export async function maybeWriteAbLearning(pool, taskRow, outcome, winner, winnerLift) {
  if (!['A', 'B'].includes(winner)) return;
  const schema = (taskRow.metrics_schema && typeof taskRow.metrics_schema === 'object') ? taskRow.metrics_schema : null;
  const isChannel = cleanText(taskRow.mode, 20) === 'channel';
  const variable = isChannel
    ? cleanText(taskRow.test_type || '测试变量', 80)
    : (taskRow.test_type === 'sms_copy' ? '文案风格' : cleanText(taskRow.test_type || '测试变量', 80));
  const channel = cleanText(taskRow.channel || (taskRow.test_type === 'sms_copy' ? 'sms' : taskRow.test_type), 80);
  const variantA = taskRow?.variant_a && typeof taskRow.variant_a === 'object' ? taskRow.variant_a : {};
  const variantB = taskRow?.variant_b && typeof taskRow.variant_b === 'object' ? taskRow.variant_b : {};
  const winDef = winner === 'A' ? variantA : variantB;
  const loseDef = winner === 'A' ? variantB : variantA;
  const metricLabel = (schema && schema.primary && schema.primary.label) || '核销率';
  const sample = Math.max(
    Number(outcome?.byVariant?.A?.sample || outcome?.byVariant?.A?.sent || 0),
    Number(outcome?.byVariant?.B?.sample || outcome?.byVariant?.B?.sent || 0)
  );
  await pool.query(
    `INSERT INTO growth_learnings (
       source_type, source_id, store_code, channel, scene, audience_tag, variable,
       winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, is_verified, tenant_id
     ) VALUES ('ab_test',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13)
     ON CONFLICT DO NOTHING`,
    [
      String(taskRow.id),
      cleanText(taskRow.store_code, 128),
      channel,
      isChannel ? null : '晚市',
      isChannel ? null : '7日未到店',
      variable,
      cleanText(winDef.content || winDef.label || winner, 500),
      cleanText(loseDef.content || loseDef.label || (winner === 'A' ? 'B' : 'A'), 500),
      cleanText(`${metricLabel}+${Number(winnerLift || 0).toFixed(2)}%`, 255),
      sample,
      sample >= 100 ? 'high' : 'medium',
      ymdAddDays(todayShanghaiYmd(), 90),
      resolveTenantIdDefault()
    ]
  ).catch(() => {});
}

function abMetricValue(v, metric) {
  const sent = Number(v?.sent || 0);
  switch (cleanText(metric, 40)) {
    case 'click_rate':
    case 'response_rate':
      return sent > 0 ? Number((Number(v?.clicks || 0) / sent).toFixed(4)) : 0;
    case 'revenue':
      return Number(v?.revenue || 0);
    case 'revenue_per_order':
      return Number(v?.revenue_per_order || 0);
    case 'redemption_rate':
    default:
      return Number(v?.redemption_rate || 0);
  }
}

export async function evaluateAbTask(pool, taskRow, tenantId = 'default') {
  const outcome = await computeAbTestOutcome(pool, taskRow, tenantId);
  if (!outcome) return null;
  const a = outcome.byVariant.A || {};
  const b = outcome.byVariant.B || {};
  const minSample = Math.max(1, Math.floor(Number(taskRow?.min_sample_size) || 30));
  const schema = (taskRow.metrics_schema && typeof taskRow.metrics_schema === 'object') ? taskRow.metrics_schema : null;
  let rateA, rateB, isRate;
  if (schema && schema.primary) {
    if ((a.sample || 0) < minSample || (b.sample || 0) < minSample) return { outcome, finalized: false };
    rateA = Number(a.primary || 0);
    rateB = Number(b.primary || 0);
    isRate = schema.primary.format === 'pct';
  } else {
    if ((a.sent || 0) < minSample || (b.sent || 0) < minSample) return { outcome, finalized: false };
    const metric = taskRow?.target_metric || 'redemption_rate';
    rateA = abMetricValue(a, metric);
    rateB = abMetricValue(b, metric);
    isRate = ['redemption_rate', 'click_rate', 'response_rate'].includes(cleanText(metric, 40));
  }
  const minDiff = isRate ? 0.01 : 0.0001;
  let winner = 'tie';
  if (Math.abs(rateA - rateB) >= minDiff) winner = rateA > rateB ? 'A' : 'B';
  const base = winner === 'A' ? rateB : rateA;
  const top = winner === 'A' ? rateA : rateB;
  const winnerLift = winner === 'tie' ? 0 : Number((base > 0 ? ((top - base) / base) * 100 : top * 100).toFixed(2));
  const aiSummary = await buildAbAiSummary(taskRow, outcome);
  const status = safeDateOnly(taskRow.end_date) <= todayShanghaiYmd() ? 'completed' : 'running';
  const updated = await pool.query(
    `UPDATE ab_test_tasks
        SET winner = $2,
            winner_lift = $3,
            ai_summary = $4,
            status = $5
      WHERE id = $1
      RETURNING *`,
    [Number(taskRow.id), winner, winnerLift, cleanText(aiSummary, 4000), status]
  );
  await maybeWriteAbLearning(pool, updated.rows[0] || taskRow, outcome, winner, winnerLift);
  return { outcome, finalized: true, task: updated.rows[0] || taskRow };
}

export async function promoteAbWinner(pool, task, operatorName, tenantId = 'default') {
  const winner = String(task.winner || '').toUpperCase();
  if (winner !== 'A' && winner !== 'B') return { ok: false, error: 'no_winner_yet', message: '该测试尚无明确赢家：需先录入结果并判定 A/B 胜负后才能采用。' };
  const winnerDef = (winner === 'A' ? task.variant_a : task.variant_b) || {};
  const operator = cleanText(operatorName || 'system', 80);
  const targetKind = cleanText(task.target_kind || '', 40);
  const targetRuleKey = cleanText(task.target_rule_key || '', 200);
  const logAbDecision = (content) => pool.query(
    `INSERT INTO decision_log (store, brand, decision_type, title, content, agent, source_task_id, created_by, status, tenant_id)
     VALUES ($1, NULL, 'ab_test_promotion', $2, $3, 'growth-ab', $4, $5, 'active', $6)`,
    [cleanText(task.store_code, 200) || 'unknown', cleanText(task.test_name || 'A/B测试', 500), content, String(task.id), operator, tenantId]
  ).catch(e => log.error({ msg: 'growth_ab_decision_log_write_failed', err: e?.message }));

  if (targetRuleKey && (targetKind === 'touch_rule' || targetKind === 'payment_rule')) {
    if (winner === 'A') {
      await pool.query(`UPDATE ab_test_tasks SET promoted_rule_key = $2 WHERE id = $1`, [task.id, targetRuleKey]).catch(() => {});
      await logAbDecision(`A组(当前版本)胜出，规则${targetRuleKey}维持不变。`);
      return { ok: true, rule_key: targetRuleKey, winner, kept_current: true, message: 'A组(当前版本)胜出，规则维持不变。' };
    }
    if (targetKind === 'touch_rule') {
      const ruleRes = await pool.query(`SELECT * FROM growth_touch_rules WHERE rule_key = $1 AND tenant_id = $2 LIMIT 1`, [targetRuleKey, tenantId]);
      if (!ruleRes.rows?.length) return { ok: false, error: 'target_rule_not_found' };
      const row = ruleRes.rows[0];
      const ap = (row.action_payload && typeof row.action_payload === 'object') ? Object.assign({}, row.action_payload) : {};
      const content = cleanText(winnerDef.content || winnerDef.text || '', 2000);
      if (content) { ap.content_template = content; ap.template_text = content; }
      if (winnerDef.coupon_value != null && winnerDef.coupon_value !== '') {
        ap.coupon_value = Number(winnerDef.coupon_value); ap.value = Number(winnerDef.coupon_value);
      }
      ap.source_ab_test_id = task.id; ap.ab_winner = winner; ap.ab_winner_lift = Number(task.winner_lift || 0);
      const upd = await pool.query(
        `UPDATE growth_touch_rules
            SET action_payload = $2::jsonb,
                approved_by = $3, approved_at = NOW(),
                note = $4, updated_at = NOW()
          WHERE rule_key = $1 AND tenant_id = $5
          RETURNING *`,
        [targetRuleKey, JSON.stringify(ap),
         operator,
         cleanText(`A/B #${task.id}「${task.test_name}」B组胜出(+${Number(task.winner_lift || 0)}%)，已采用为当前版本（经办人:${operator}）`, 1000),
         tenantId]
      );
      await pool.query(`UPDATE ab_test_tasks SET promoted_rule_key = $2 WHERE id = $1`, [task.id, targetRuleKey]).catch(() => {});
      await logAbDecision(`B组胜出(+${Number(task.winner_lift || 0)}%)，已采用为触达规则${targetRuleKey}的当前版本。`);
      return { ok: true, rule: upd.rows[0], rule_key: targetRuleKey, winner, kind: targetKind };
    }
    const ruleRes = await pool.query(`SELECT * FROM marketing_payment_rules WHERE rule_key = $1 LIMIT 1`, [targetRuleKey]);
    if (!ruleRes.rows?.length) return { ok: false, error: 'target_rule_not_found' };
    const templateId = cleanText(winnerDef.template_id, 128);
    const triggerValue = winnerDef.trigger_value != null ? String(winnerDef.trigger_value) : null;
    const upd = await pool.query(
      `UPDATE marketing_payment_rules
          SET member_template_id = COALESCE(NULLIF($2,''), member_template_id),
              trigger_value = COALESCE($3, trigger_value),
              updated_at = NOW()
        WHERE rule_key = $1
        RETURNING *`,
      [targetRuleKey, templateId, triggerValue]
    );
    await pool.query(`UPDATE ab_test_tasks SET promoted_rule_key = $2 WHERE id = $1`, [task.id, targetRuleKey]).catch(() => {});
    await logAbDecision(`B组胜出，已采用为支付规则${targetRuleKey}的当前版本。`);
    return { ok: true, rule: upd.rows[0], rule_key: targetRuleKey, winner, kind: targetKind };
  }

  if (cleanText(task.mode, 20) === 'channel') {
    const outcome = await computeAbTestOutcome(pool, task, tenantId).catch(() => null);
    await maybeWriteAbLearning(pool, task, outcome, winner, Number(task.winner_lift || 0));
    await pool.query(`UPDATE ab_test_tasks SET promoted_rule_key = $2 WHERE id = $1`, [task.id, 'learning:' + task.id]).catch(() => {});
    await logAbDecision(`「${task.channel}」渠道${winner}组胜出，已沉淀到经验库(growth_learnings)。`);
    return { ok: true, winner, channel: task.channel, learned: true, message: `已将「${task.channel}」胜出版本沉淀到经验库，供内容建议复用。` };
  }

  return { ok: false, error: 'not_promotable', message: '该测试无可采用的回路（既未绑定规则也非渠道模式）。' };
}

export function isAbManualInput(task) {
  return !!cleanText(task?.target_rule_key, 200) || !!(task?.metrics_schema && typeof task.metrics_schema === 'object');
}

export function listAbTemplates() {
  return AB_TEMPLATES;
}

export async function listAbTests(pool, tenantId, opts = {}) {
  const storeCode = cleanText(opts.storeCode || '', 128);
  const status = cleanText(opts.status || '', 40);
  const r = await pool.query(
    `SELECT * FROM ab_test_tasks
      WHERE tenant_id = $3
        AND ($1 = '' OR store_code = $1)
        AND ($2 = '' OR status = $2)
      ORDER BY created_at DESC
      LIMIT 100`,
    [storeCode, status, tenantId]
  );
  const tasks = [];
  for (const row of r.rows || []) {
    const outcome = await computeAbTestOutcome(pool, row, tenantId).catch(() => null);
    const daily = await pool.query(
      `SELECT * FROM ab_test_results WHERE test_id = $1 AND tenant_id = $2 ORDER BY result_date ASC, variant ASC`,
      [row.id, tenantId]
    ).catch(() => ({ rows: [] }));
    tasks.push({ ...row, metrics: outcome?.byVariant || {}, results: daily.rows || [] });
  }
  return tasks;
}

export async function createAbTest(pool, tenantId, body, authUser) {
  const b = body || {};
  const testName = cleanText(b.test_name, 255);
  const storeCode = cleanText(b.store_code, 128);
  const startDate = safeDateOnly(b.start_date) || todayShanghaiYmd();
  const endDate = safeDateOnly(b.end_date) || ymdAddDays(startDate, 7);
  if (!testName || !storeCode) throw httpError('missing_test_name_or_store_code');

  const template = getAbTemplate(b.template_key) || getAbTemplate('sms');
  const minSample = Math.max(1, Math.floor(Number(b.min_sample_size) || 30));

  let fields, primary, extra;
  if (template.key === 'custom') {
    fields = sanitizeFields(b.fields);
    if (!fields.length) throw httpError('missing_custom_fields', 400, '自定义模板需至少定义 1 个字段');
    primary = sanitizeMetricDef(b.primary, fields.map((f) => f.key));
    if (!primary) throw httpError('invalid_primary_metric', 400, '请正确指定主判定指标(分子字段必填)');
    extra = [];
  } else {
    fields = template.fields;
    primary = template.primary;
    extra = template.extra || [];
  }
  const metricsSchema = { fields, primary, extra };
  const targetMetric = primary ? cleanText(primary.key, 80) : 'redemption_rate';

  if (template.scope === 'bound') {
    const targetKind = template.bind_kind;
    const targetRuleKey = cleanText(b.target_rule_key, 200);
    if (!targetRuleKey) throw httpError('missing_target_rule_key', 400, 'A/B 测试需绑定一条已有规则（规则引擎/订阅/支付发券）');
    const bound = await loadAbBoundRule(pool, targetKind, targetRuleKey);
    if (!bound) throw httpError('bound_rule_not_found', 404, '未找到要绑定的规则，请确认 rule_key');
    const variantA = bound.variant_a;
    const variantB = (b.variant_b && typeof b.variant_b === 'object') ? Object.assign({ label: '挑战者(B)' }, b.variant_b) : { label: '挑战者(B)' };
    const testType = targetKind === 'payment_rule' ? 'coupon_value' : 'sms_copy';
    const created = await pool.query(
      `INSERT INTO ab_test_tasks (
         test_name, store_code, test_type, target_metric, target_kind, target_rule_key,
         mode, channel, template_key, metrics_schema,
         variant_a, variant_b, rotation_config, start_date, end_date,
         min_sample_size, created_by, status, tenant_id
       ) VALUES ($1,$2,$3,$4,$5,$6,'bound',$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15,$16,'running',$17)
       RETURNING *`,
      [
        testName, storeCode, testType, targetMetric, targetKind, targetRuleKey,
        cleanText(template.channel, 80), template.key, JSON.stringify(metricsSchema),
        JSON.stringify(variantA), JSON.stringify(variantB),
        JSON.stringify({ method: 'manual' }), startDate, endDate,
        minSample, cleanText(authUser?.username || 'system', 80),
        tenantId
      ]
    );
    return created.rows[0];
  }

  const channel = template.key === 'custom' ? (cleanText(b.channel, 80) || '自定义') : template.channel;
  const variable = cleanText(b.variable, 80) || '内容版本';
  const variantA = (b.variant_a && typeof b.variant_a === 'object')
    ? Object.assign({ label: 'A版本' }, b.variant_a)
    : { label: 'A版本', content: cleanText(b.variant_a_text || '', 2000) };
  const variantB = (b.variant_b && typeof b.variant_b === 'object')
    ? Object.assign({ label: 'B版本' }, b.variant_b)
    : { label: 'B版本', content: cleanText(b.variant_b_text || '', 2000) };
  if (!cleanText(variantA.content, 2000) || !cleanText(variantB.content, 2000)) {
    throw httpError('missing_variants', 400, '请填写 A/B 两个版本的内容描述');
  }
  const created = await pool.query(
    `INSERT INTO ab_test_tasks (
       test_name, store_code, test_type, target_metric,
       mode, channel, template_key, metrics_schema,
       variant_a, variant_b, rotation_config, start_date, end_date,
       min_sample_size, created_by, status, tenant_id
     ) VALUES ($1,$2,$3,$4,'channel',$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,'running',$15)
     RETURNING *`,
    [
      testName, storeCode, variable, targetMetric,
      channel, template.key, JSON.stringify(metricsSchema),
      JSON.stringify(variantA), JSON.stringify(variantB),
      JSON.stringify({ method: 'manual' }), startDate, endDate,
      minSample, cleanText(authUser?.username || 'system', 80),
      tenantId
    ]
  );
  return created.rows[0];
}

export async function submitAbTestResults(pool, tenantId, testId, body) {
  const id = Number(testId || 0);
  if (!id) throw httpError('invalid_id');
  const taskRes = await pool.query(`SELECT * FROM ab_test_tasks WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  if (!taskRes.rows?.length) throw httpError('task_not_found', 404);
  const task = taskRes.rows[0];
  const b = body || {};
  const resultDate = safeDateOnly(b.result_date) || todayShanghaiYmd();
  const groups = [];
  if (b.A) groups.push(['A', b.A]);
  if (b.B) groups.push(['B', b.B]);
  if (!groups.length) throw httpError('missing_results', 400, '请提供 A/B 两组结果数据');

  const schema = (task.metrics_schema && typeof task.metrics_schema === 'object') ? task.metrics_schema : null;
  if (schema && Array.isArray(schema.fields) && schema.fields.length) {
    for (const [variant, data] of groups) {
      const metrics = {};
      schema.fields.forEach((f) => { metrics[f.key] = Math.max(0, Number((data || {})[f.key]) || 0); });
      await upsertAbTaskMetrics(pool, id, resultDate, variant, metrics, tenantId);
    }
  } else {
    for (const [variant, g] of groups) {
      const sent = Math.max(0, Math.floor(Number(g.sent) || 0));
      const redemptions = Math.max(0, Math.floor(Number(g.redemptions) || 0));
      await upsertAbTaskResult(pool, {
        test_id: id, result_date: resultDate, variant, sent,
        impressions: Math.max(0, Math.floor(Number(g.impressions) || 0)),
        clicks: Math.max(0, Math.floor(Number(g.clicks) || 0)),
        orders: Math.max(0, Math.floor(Number(g.orders) || g.redemptions || 0)),
        redemptions, revenue: Number(g.revenue || 0),
        conversion_rate: sent > 0 ? redemptions / sent : 0
      }, tenantId);
    }
  }
  const evaluated = await evaluateAbTask(pool, task, tenantId);
  const latest = await pool.query(`SELECT * FROM ab_test_tasks WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return { task: latest.rows[0], evaluated };
}

export async function refreshAbTest(pool, tenantId, testId) {
  const id = Number(testId || 0);
  if (!id) throw httpError('invalid_id');
  const taskRes = await pool.query(`SELECT * FROM ab_test_tasks WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  if (!taskRes.rows?.length) throw httpError('task_not_found', 404);
  const task = taskRes.rows[0];
  const manualInput = isAbManualInput(task);
  const refreshed = manualInput ? null : await refreshAbTestResults(pool, task, tenantId);
  const evaluated = (manualInput || safeDateOnly(task.end_date) <= todayShanghaiYmd())
    ? await evaluateAbTask(pool, task, tenantId)
    : null;
  const latest = await pool.query(`SELECT * FROM ab_test_tasks WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return { task: latest.rows[0], refreshed, evaluated };
}

export async function promoteAbTest(pool, tenantId, testId, operatorName) {
  const id = Number(testId || 0);
  if (!id) throw httpError('invalid_id');
  const taskRes = await pool.query(`SELECT * FROM ab_test_tasks WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
  if (!taskRes.rows?.length) throw httpError('task_not_found', 404);
  return promoteAbWinner(pool, taskRes.rows[0], operatorName, tenantId);
}

export async function listLearnings(pool, opts = {}) {
  const storeCode = cleanText(opts.storeCode || '', 128);
  const channel = cleanText(opts.channel || '', 80);
  let limit = Math.floor(Number(opts.limit));
  if (!Number.isFinite(limit)) limit = 200;
  limit = Math.min(Math.max(limit, 1), 200);
  const r = await pool.query(
    `SELECT * FROM growth_learnings
      WHERE ($1 = '' OR store_code = $1)
        AND ($2 = '' OR channel = $2)
      ORDER BY created_at DESC
      LIMIT $3`,
    [storeCode, channel, limit]
  );
  return r.rows;
}

export async function createLearning(pool, tenantId, body) {
  const b = body || {};
  const channel = cleanText(b.channel, 80);
  const variable = cleanText(b.variable, 120);
  const winningValue = cleanText(b.winning_value, 500);
  if (!channel || !variable || !winningValue) {
    throw httpError('missing_fields', 400, 'missing channel, variable, or winning_value');
  }
  const r = await pool.query(
    `INSERT INTO growth_learnings (
       source_type, source_id, store_code, channel, scene, audience_tag, variable,
       winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, tenant_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      cleanText(b.source_type || 'manual', 80),
      cleanText(b.source_id || `manual_${Date.now()}`, 200),
      cleanText(b.store_code, 128),
      channel,
      b.scene ? cleanText(b.scene, 80) : null,
      b.audience_tag ? cleanText(b.audience_tag, 120) : null,
      variable,
      winningValue,
      b.losing_value ? cleanText(b.losing_value, 500) : null,
      b.effect_desc ? cleanText(b.effect_desc, 255) : null,
      Math.max(0, Math.floor(Number(b.sample_size) || 0)),
      cleanText(b.confidence || 'medium', 20),
      b.valid_until ? safeDateOnly(b.valid_until) : ymdAddDays(todayShanghaiYmd(), 90),
      tenantId
    ]
  );
  return r.rows[0] || null;
}

const LEARNING_SEEDS = [
  ['manual','seed_sms_01','51866138','sms','晚市','7日未到店','文案风格','个性化称呼（含姓名）','无称呼通用文案','核销率+22%',120,'high'],
  ['manual','seed_sms_02','51866138','sms','晚市','7日未到店','折扣类型','减8元券','8折券','核销率+11%',98,'medium'],
  ['manual','seed_sms_03','51866138','sms','晚市','7日未到店','发送时段','17:00-18:00','11:00-12:00','核销率+18%',84,'medium'],
  ['manual','seed_sms_04','64822111','sms','晚市','7日未到店','文案风格','个性化称呼（含姓名）','无称呼通用文案','核销率+19%',67,'medium'],
  ['manual','seed_sms_05','51866138','sms','午市','新客','折扣类型','单人套餐+赠品','直接打折','核销率+14%',55,'medium'],
  ['manual','seed_sms_06','51866138','sms','节假日','全部客户','文案类型','节日祝福+优惠券','纯优惠券','核销率+9%',200,'high'],
  ['manual','seed_sms_07','64822111','sms','节假日','7日未到店','有效期','3天有效期','7天有效期','核销率+16%',76,'medium'],
  ['manual','seed_xhs_01','51866138','xiaohongshu',null,null,'内容策略','烟火气风格+真实场景图','精修美食图','点击率+31%',1800,'high'],
  ['manual','seed_xhs_02','51866138','xiaohongshu','午市',null,'文案风格','打工人共鸣标题','直白菜品介绍','曝光量+45%',2200,'high'],
  ['manual','seed_xhs_03','64822111','xiaohongshu',null,null,'封面图风格','顾客就餐实拍','摆盘特写','收藏率+22%',1200,'medium'],
  ['manual','seed_xhs_04','51866138','xiaohongshu','晚市',null,'发布时段','18:00-20:00','12:00-14:00','互动率+27%',950,'high'],
  ['manual','seed_wxwork_01','51866138','wechat_work','晚市','7日未到店','消息频率','每月1次','每周1次','取消关注率-38%',180,'high'],
  ['manual','seed_wxwork_02','51866138','wechat_work',null,'高价值客户','内容类型','专属会员权益','通用促销信息','核销率+33%',90,'high'],
  ['manual','seed_wxwork_03','64822111','wechat_work','午市','新客','首次触达时机','到店后3天内','到店后7天内','复购率+25%',63,'medium'],
  ['manual','seed_dianping_01','51866138','dianping',null,null,'评价回复','个性化回复+感谢','模板统一回复','好评率+8%',320,'high'],
  ['manual','seed_dianping_02','51866138','dianping',null,null,'封面图','顾客实拍授权图','商家官拍图','点击率+19%',4500,'high'],
  ['manual','seed_dianping_03','64822111','dianping',null,null,'团购设置','单人套餐（性价比优先）','多人套餐','核销率+41%',220,'high'],
  ['manual','seed_coupon_01','51866138','sms',null,'老客户','券面值','减10元（门槛40）','减8元（无门槛）','核销率+17%',145,'high'],
  ['manual','seed_coupon_02','51866138','sms',null,'新客','有效期','7天','30天','核销率+29%',88,'medium'],
  ['manual','seed_coupon_03','64822111','miniprogram',null,'7日未到店','券样式','菜品绑定券（烧鹅专用）','通用代金券','核销率+23%',72,'medium'],
  ['manual','seed_content_01','51866138','sms','晚市','全部客户','主推菜品','本周热卖（数据支撑）','固定招牌菜','到店率+12%',310,'high'],
  ['manual','seed_content_02','51866138','xiaohongshu',null,null,'话题选择','本地探店+区域话题','品牌自建话题','曝光+67%',3100,'high'],
  ['manual','seed_content_03','64822111','xiaohongshu','午市',null,'图片数量','9张（含菜品+环境+顾客）','3张精选图','互动率+18%',780,'medium'],
  ['manual','seed_activity_01','51866138','sms',null,'高频客户（月均3次+）','活动类型','升级权益（生日月双倍积分）','一次性折扣','留存率+28%',95,'high'],
  ['manual','seed_activity_02','51866138','wechat_work',null,'沉睡客户（90天未到店）','召回方式','定向发放高价值券（满50减20）','通用消息推送','召回率+19%',48,'medium'],
  ['manual','seed_activity_03','64822111','sms',null,'节前7天','触达节点','节前3天发券','节当天发券','核销率+34%',156,'high'],
  ['manual','seed_store_01','51866138','sms','晚市','7日未到店','短信内容场景化','提及具体菜品（烧鹅/荔枝木）','不提菜品','核销率+15%',134,'high'],
  ['manual','seed_store_02','64822111','xiaohongshu',null,null,'达人合作','本地素人探店（1k-5k粉丝）','KOL付费推广','ROI+2.3倍',8,'medium'],
  ['manual','seed_time_01','51866138','sms','午市','上班族','发送时间','工作日11:00','工作日08:00','开率+22%',267,'high'],
  ['manual','seed_time_02','51866138','sms','晚市','家庭客','发送时间','周五17:00','周一17:00','核销率+19%',189,'high'],
  ['manual','seed_time_03','51866138','xiaohongshu',null,null,'发帖时间','周四晚20:00（周末预热）','周一早09:00','互动量+38%',1650,'high'],
];

export async function seedLearnings(pool, tenantId) {
  const today = todayShanghaiYmd();
  const validUntil = ymdAddDays(today, 180);
  let inserted = 0;
  for (const [srcType, srcId, storeCode, channel, scene, audienceTag, variable,
               winVal, loseVal, effectDesc, sampleSize, confidence] of LEARNING_SEEDS) {
    await pool.query(
      `INSERT INTO growth_learnings (
         source_type, source_id, store_code, channel, scene, audience_tag, variable,
         winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, tenant_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT DO NOTHING`,
      [srcType, srcId, storeCode, channel, scene, audienceTag, variable,
       winVal, loseVal, effectDesc, sampleSize, confidence, validUntil, tenantId || resolveTenantIdDefault()]
    ).catch(() => {});
    inserted += 1;
  }
  const count = await pool.query(`SELECT COUNT(*)::int AS cnt FROM growth_learnings`);
  return { seeded: inserted, total: count.rows[0]?.cnt || 0 };
}

export async function listPriceTests(pool, tenantId, opts = {}) {
  const storeCode = cleanText(opts.storeCode || '', 128);
  const status = cleanText(opts.status || '', 40);
  const r = await pool.query(
    `SELECT * FROM ab_test_tasks
      WHERE test_type IN ('price_test', 'price_bundle')
        AND tenant_id = $3
        AND ($1 = '' OR store_code = $1)
        AND ($2 = '' OR status = $2)
      ORDER BY created_at DESC
      LIMIT 100`,
    [storeCode, status, tenantId]
  );
  const tasks = [];
  for (const row of r.rows || []) {
    const outcome = await computeAbTestOutcome(pool, row, tenantId).catch(() => null);
    tasks.push({ ...row, metrics: outcome?.byVariant || {} });
  }
  return tasks;
}

export async function createPriceTest(pool, tenantId, body, authUser) {
  const b = body || {};
  const testName = cleanText(b.test_name, 255);
  const storeCode = cleanText(b.store_code, 128);
  if (!testName || !storeCode) throw httpError('missing_fields', 400, 'missing test_name or store_code');
  const startDate = safeDateOnly(b.start_date) || todayShanghaiYmd();
  const endDate = safeDateOnly(b.end_date) || ymdAddDays(startDate, 14);
  const testType = b.test_type === 'price_bundle' ? 'price_bundle' : 'price_test';
  const targetMetric = cleanText(b.target_metric || 'revenue_per_order', 80);
  const r = await pool.query(
    `INSERT INTO ab_test_tasks (
       test_name, store_code, test_type, target_metric,
       variant_a, variant_b, rotation_config, start_date, end_date,
       min_sample_size, created_by, status, tenant_id
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,'running',$12)
     RETURNING *`,
    [
      testName, storeCode, testType, targetMetric,
      JSON.stringify(b.variant_a || {}),
      JSON.stringify(b.variant_b || {}),
      JSON.stringify(b.rotation_config || { method: 'store', note: '不同门店或不同日期轮换' }),
      startDate, endDate,
      Math.max(1, Math.floor(Number(b.min_sample_size) || 50)),
      cleanText(authUser?.username || 'system', 80),
      tenantId
    ]
  );
  return r.rows[0];
}
