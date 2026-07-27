/**
 * A/B 测试任务的增删查、结果录入与刷新/采用编排（从 growth-ab/service 外提）。
 */
import { cleanText } from '../growth-phase-auth.js';
import { safeDateOnly, todayShanghaiYmd, ymdAddDays } from './dates.js';
import { getAbTemplate } from './ab-templates.js';
import { isAbManualInput, sanitizeFields, sanitizeMetricDef } from './ab-metrics.js';
import { computeAbTestOutcome, refreshAbTestResults, upsertAbTaskMetrics, upsertAbTaskResult } from './ab-outcome-service.js';
import { evaluateAbTask, promoteAbWinner } from './ab-evaluation-service.js';

function httpError(code, status = 400, message = '') {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
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
