/**
 * Ontology 路由业务层：SQL / 编排。不碰 req/res；tenantId/storeId/username 由调用方传入。
 */

import { lintMetrics } from './metric-lint.js';
import {
  generateActionPlanFromInsights,
  generateBossSummary,
  inferIssuesFromMetrics,
} from './business-ontology-engine.js';
import { buildMarketingAttributionMetricsInput } from '../marketing/marketing-attribution-service.js';
import { ensureGrowthOntologyCore } from './growth-ontology-schema.js';
import { runDailyDiagnosis, listIssues, listOpportunities } from './diagnosis-tree-service.js';
import { generateTasksForOpportunity } from './action-plan-service.js';
import { trackGrowthResults } from './result-tracking-service.js';
import { generateGrowthAttribution } from './growth-attribution-service.js';
import { buildClosedLoopReport } from './closed-loop-report-service.js';
import {
  ensureOntologyRuleConfig,
  evaluateRules,
  getRuleThreshold,
  loadEffectiveRules,
} from './ontology-rule-service.js';
import { syncOntologyDataFromProduction } from './real-data-sync.js';
import { runOntologyDailyDiagnosisForTenant } from './daily-diagnosis-scheduler.js';

export async function ensureGrowth(pool) {
  try {
    await ensureGrowthOntologyCore(pool);
    await ensureOntologyRuleConfig(pool);
  } catch (e) {
    console.error('[ontology] growth ontology init error:', e?.message || e);
    throw e;
  }
}

export async function runMetricLint(pool) {
  const result = await pool.query(
    `SELECT metric_id, name, data_source, formula FROM metric_dictionary ORDER BY name, metric_id`
  );
  return { findings: lintMetrics(result.rows || []) };
}

export function inferMarketingFromBody(body = {}) {
  const metricsInput = body?.metricsInput || buildMarketingAttributionMetricsInput(body?.attributionSummary || body || {});
  if (metricsInput.ontologyStatus === 'insufficient_data') {
    return {
      ontologyStatus: 'insufficient_data',
      marketingInsights: [],
      bossSummary: '当前归因数据不足，暂无法生成营销经营判断。',
      actionPlan: [],
      trackingMetrics: [],
    };
  }
  const marketingInsights = inferIssuesFromMetrics(metricsInput);
  return {
    ontologyStatus: marketingInsights.length ? 'ok' : 'no_issue_detected',
    marketingInsights,
    bossSummary: generateBossSummary(marketingInsights),
    actionPlan: generateActionPlanFromInsights(marketingInsights),
    trackingMetrics: [...new Set(marketingInsights.flatMap(item => item.trackingMetrics || []))],
  };
}

export async function getDailyDiagnosis(pool, { tenantId, storeId = '', date = '' } = {}) {
  await ensureGrowth(pool);
  await syncOntologyDataFromProduction(pool, tenantId);
  return runDailyDiagnosis(pool, { tenantId, storeId, date });
}

export async function runDiagnosis(pool, { tenantId, storeId = '', date = '' } = {}) {
  await ensureGrowth(pool);
  const syncResult = await syncOntologyDataFromProduction(pool, tenantId);
  const result = await runDailyDiagnosis(pool, { tenantId, storeId, date });
  return { syncResult, ...result };
}

export async function runDailyDiagnosisAll(pool, { tenantId, date = '', storeIds } = {}) {
  await ensureGrowth(pool);
  return runOntologyDailyDiagnosisForTenant(pool, tenantId, {
    date,
    storeIds: Array.isArray(storeIds) ? storeIds : undefined,
  });
}

export async function getIssues(pool, { tenantId, storeId = '' } = {}) {
  await ensureGrowth(pool);
  return listIssues(pool, { tenantId, storeId });
}

export async function getOpportunities(pool, { tenantId, storeId = '' } = {}) {
  await ensureGrowth(pool);
  return listOpportunities(pool, { tenantId, storeId });
}

export async function generateOpportunityTasks(pool, opportunityId, { tenantId, storeId = '', ownerUserId = '' } = {}) {
  await ensureGrowth(pool);
  return generateTasksForOpportunity(pool, opportunityId, { tenantId, storeId, ownerUserId });
}

export async function trackResults(pool, { tenantId, storeId = '', opportunityId = '' } = {}) {
  await ensureGrowth(pool);
  return trackGrowthResults(pool, { tenantId, storeId, opportunityId });
}

export async function runAttribution(pool, opts = {}) {
  await ensureGrowth(pool);
  return generateGrowthAttribution(pool, {
    tenantId: opts.tenantId,
    storeId: opts.storeId || '',
    campaignId: opts.campaignId || '',
    opportunityId: opts.opportunityId || '',
    taskId: opts.taskId || '',
    attributionWindowDays: opts.attributionWindowDays || 7,
    scenario: opts.scenario || '',
  });
}

export async function getClosedLoopReport(pool, { tenantId, storeId = '', period = '30d' } = {}) {
  await ensureGrowth(pool);
  return buildClosedLoopReport(pool, { tenantId, storeId, period });
}

export async function listOntologyRules(pool, {
  tenantId,
  storeId = '',
  ruleType = '',
  businessDomain = '',
} = {}) {
  await ensureOntologyRuleConfig(pool);
  const rules = await loadEffectiveRules(pool, {
    tenantId,
    storeId,
    ruleType,
    businessDomain,
  });
  const hits = await pool.query(
    `SELECT rule_id, count(*)::int AS hit_count
       FROM ontology_rule_hits
      WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2)
        AND hit_at >= now() - interval '30 days'
      GROUP BY rule_id`,
    [tenantId, storeId]
  );
  const hitMap = new Map((hits.rows || []).map(row => [row.rule_id, Number(row.hit_count || 0)]));
  const enriched = [];
  for (const rule of rules) {
    const thresholdRows = await pool.query(
      `SELECT threshold_key, threshold_value, threshold_unit, comparator
         FROM ontology_rule_thresholds
        WHERE rule_id=$1 AND is_active=true
          AND ((tenant_id IS NULL AND store_id IS NULL) OR (tenant_id=$2 AND store_id IS NULL) OR (tenant_id=$2 AND store_id=$3))
        ORDER BY threshold_key, updated_at DESC`,
      [rule.rule_id, tenantId, storeId]
    );
    enriched.push({
      ...rule,
      condition_json: undefined,
      action_json: undefined,
      thresholds: thresholdRows.rows || [],
      recentHitCount: hitMap.get(rule.rule_id) || 0,
    });
  }
  return enriched;
}

export async function updateOntologyRule(pool, {
  tenantId,
  storeId = '',
  ruleId,
  body = {},
  username = 'api',
} = {}) {
  await ensureOntologyRuleConfig(pool);
  const store = String(storeId || '').trim();
  const baseRules = await loadEffectiveRules(pool, {
    tenantId,
    storeId: store,
    ruleType: body?.rule_type || 'diagnosis',
  });
  const base = baseRules.find(rule => rule.rule_id === ruleId);
  if (!base) return { ok: false, error: 'rule_not_found' };

  const versionResult = await pool.query(
    `SELECT COALESCE(max(version),0)::int + 1 AS next_version
       FROM ontology_rules
      WHERE rule_id=$1 AND tenant_id=$2 AND COALESCE(store_id,'')=COALESCE($3,'')`,
    [ruleId, tenantId, store || null]
  );
  const nextVersion = Number(versionResult.rows?.[0]?.next_version || Number(base.version || 1) + 1);
  await pool.query(
    `UPDATE ontology_rules SET is_active=false, updated_at=now()
      WHERE rule_id=$1 AND tenant_id=$2 AND COALESCE(store_id,'')=COALESCE($3,'')`,
    [ruleId, tenantId, store || null]
  );
  const condition = body?.condition_json || body?.condition || base.condition_json || {};
  const action = body?.action_json || body?.action || base.action_json || {};
  const inserted = await pool.query(
    `INSERT INTO ontology_rules (
      rule_id, tenant_id, store_id, rule_type, rule_name, business_domain, target_metric,
      condition_json, action_json, boss_language_template, severity, priority,
      confidence_base, version, is_active, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,true,$15)
    RETURNING *`,
    [
      ruleId, tenantId, store || null, base.rule_type, body?.rule_name || base.rule_name,
      body?.business_domain || base.business_domain, body?.target_metric || base.target_metric,
      JSON.stringify(condition), JSON.stringify(action), body?.boss_language_template || base.boss_language_template,
      body?.severity || base.severity, body?.priority || base.priority,
      Number(body?.confidence_base || base.confidence_base || 0.75), nextVersion, username || 'api',
    ]
  );
  const thresholds = body?.thresholds || {};
  for (const [key, value] of Object.entries(thresholds)) {
    if (value === '' || value == null) continue;
    const existingDefault = await getRuleThreshold(pool, {
      tenantId,
      storeId: store,
      ruleId,
      thresholdKey: key,
      defaultValue: Number(value),
    });
    await pool.query(
      `INSERT INTO ontology_rule_thresholds (rule_id, tenant_id, store_id, threshold_key, threshold_value, threshold_unit, comparator, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (rule_id, threshold_key, COALESCE(tenant_id, ''), COALESCE(store_id, ''))
       DO UPDATE SET threshold_value=EXCLUDED.threshold_value, updated_at=now(), is_active=true`,
      [
        ruleId, tenantId, store || null, key, Number(value),
        body?.threshold_units?.[key] || '', body?.comparators?.[key] || '',
        body?.descriptions?.[key] || `门店规则阈值 ${existingDefault}`,
      ]
    );
  }
  return { ok: true, rule: inserted.rows[0] };
}

export async function listOntologyRuleHits(pool, {
  tenantId,
  storeId = '',
  ruleId = '',
  from = '',
  to = '',
  limit = 50,
} = {}) {
  await ensureOntologyRuleConfig(pool);
  const store = String(storeId || '').trim();
  const params = [tenantId, store];
  const where = [`tenant_id=$1`, `($2::text='' OR store_id=$2)`];
  if (ruleId) {
    params.push(ruleId);
    where.push(`rule_id=$${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`hit_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    where.push(`hit_at <= $${params.length}::timestamptz`);
  }
  const cappedLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
  params.push(cappedLimit);
  const result = await pool.query(
    `SELECT id, tenant_id, store_id, rule_id, rule_version, rule_type,
            generated_issue_id, generated_opportunity_id, generated_task_id,
            confidence_score, severity, boss_language_output, hit_at
       FROM ontology_rule_hits
      WHERE ${where.join(' AND ')}
      ORDER BY hit_at DESC
      LIMIT $${params.length}`,
    params
  );
  return result.rows || [];
}

export async function evaluateOntologyRules(pool, {
  tenantId,
  storeId = '',
  businessDomain = '',
  ruleType = 'diagnosis',
  inputContext = {},
} = {}) {
  await ensureOntologyRuleConfig(pool);
  return evaluateRules(pool, {
    tenantId,
    storeId,
    businessDomain,
    ruleType,
    inputContext,
  });
}

export async function disableOntologyRule(pool, { tenantId, storeId = '', ruleId } = {}) {
  await ensureOntologyRuleConfig(pool);
  const store = String(storeId || '').trim();
  await pool.query(
    `UPDATE ontology_rules SET is_active=false, updated_at=now()
     WHERE rule_id=$1 AND tenant_id=$2 AND COALESCE(store_id,'')=COALESCE($3,'')`,
    [ruleId, tenantId, store || null]
  );
  return { ok: true, ruleId, action: 'disabled' };
}

export async function enableOntologyRule(pool, { tenantId, storeId = '', ruleId } = {}) {
  await ensureOntologyRuleConfig(pool);
  const store = String(storeId || '').trim();
  await pool.query(
    `UPDATE ontology_rules SET is_active=true, updated_at=now()
     WHERE rule_id=$1 AND tenant_id=$2 AND COALESCE(store_id,'')=COALESCE($3,'')`,
    [ruleId, tenantId, store || null]
  );
  return { ok: true, ruleId, action: 'enabled' };
}
