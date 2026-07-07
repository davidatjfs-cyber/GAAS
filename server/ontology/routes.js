/**
 * Ontology 只读查询路由 — GET /api/ontology/:type[?id=][&limit=]
 * 沿用 store-diagnosis.js#registerDiagnosisRoutes 的注册约定。
 */

import { listObjectTypes } from './objects.js';
import { queryObject } from './query.js';
import { lintMetrics } from './metric-lint.js';
import {
  generateActionPlanFromInsights,
  generateBossSummary,
  getActionResultMappings,
  getBusinessDomains,
  getIssueActionMappings,
  getMetricIssueMappings,
  inferIssuesFromMetrics,
} from './business-ontology-engine.js';
import { createTaskDraftsFromOntologyInsights } from './task-draft-adapter.js';
import { buildMarketingAttributionMetricsInput } from '../marketing/marketing-attribution-service.js';
import { createOntologyTaskFromDraft } from './ontology-task-adapter.js';
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

export function registerOntologyRoutes(app, pool, authRequired) {
  const getTenantId = (req) => String(req.tenantId || req.user?.tenant_id || req.query?.tenant_id || req.body?.tenant_id || 'default').trim() || 'default';
  const ensureGrowth = async () => {
    try {
      await ensureGrowthOntologyCore(pool);
      await ensureOntologyRuleConfig(pool);
    } catch (e) {
      console.error('[ontology] growth ontology init error:', e?.message || e);
      throw e;
    }
  };

  app.get('/api/ontology/types', authRequired, async (req, res) => {
    return res.json({ ok: true, types: listObjectTypes() });
  });

  app.get('/api/ontology/business/domains', authRequired, async (req, res) => {
    return res.json({ ok: true, domains: getBusinessDomains() });
  });

  app.get('/api/ontology/business/mappings', authRequired, async (req, res) => {
    return res.json({
      ok: true,
      metricIssueMappings: getMetricIssueMappings(),
      issueActionMappings: getIssueActionMappings(),
      actionResultMappings: getActionResultMappings(),
    });
  });

  app.post('/api/ontology/business/infer', authRequired, async (req, res) => {
    try {
      const metricsInput = req.body?.metricsInput || req.body || {};
      const insights = inferIssuesFromMetrics(metricsInput);
      return res.json({
        ok: true,
        insights,
        bossSummary: generateBossSummary(insights),
        actionPlan: generateActionPlanFromInsights(insights),
      });
    } catch (e) {
      console.error('[ontology] business infer error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/business/task-drafts', authRequired, async (req, res) => {
    try {
      const insights = req.body?.insights;
      const metricsInput = req.body?.metricsInput || {};
      const taskDrafts = createTaskDraftsFromOntologyInsights(Array.isArray(insights) ? insights : metricsInput);
      return res.json({ ok: true, taskDrafts });
    } catch (e) {
      console.error('[ontology] task draft error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/business/create-task-from-draft', authRequired, async (req, res) => {
    try {
      const taskDraft = req.body?.taskDraft;
      if (!taskDraft) return res.status(400).json({ ok: false, error: 'taskDraft_required' });
      const result = await createOntologyTaskFromDraft(pool, taskDraft, {
        reportType: req.body?.reportType || '',
        storeId: req.body?.storeId || '',
        ownerUserId: req.body?.ownerUserId || '',
        tenantId: req.tenantId || req.user?.tenant_id || 'default',
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[ontology] create task from draft error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/business/infer-marketing', authRequired, async (req, res) => {
    try {
      const metricsInput = req.body?.metricsInput || buildMarketingAttributionMetricsInput(req.body?.attributionSummary || req.body || {});
      if (metricsInput.ontologyStatus === 'insufficient_data') {
        return res.json({
          ok: true,
          ontologyStatus: 'insufficient_data',
          marketingInsights: [],
          bossSummary: '当前归因数据不足，暂无法生成营销经营判断。',
          actionPlan: [],
          trackingMetrics: [],
        });
      }
      const marketingInsights = inferIssuesFromMetrics(metricsInput);
      return res.json({
        ok: true,
        ontologyStatus: marketingInsights.length ? 'ok' : 'no_issue_detected',
        marketingInsights,
        bossSummary: generateBossSummary(marketingInsights),
        actionPlan: generateActionPlanFromInsights(marketingInsights),
        trackingMetrics: [...new Set(marketingInsights.flatMap(item => item.trackingMetrics || []))],
      });
    } catch (e) {
      console.error('[ontology] marketing infer error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ontology/metric-lint', authRequired, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT metric_id, name, data_source, formula FROM metric_dictionary ORDER BY name, metric_id`
      );
      return res.json({ ok: true, findings: lintMetrics(result.rows || []) });
    } catch (e) {
      console.error('[ontology] metric lint error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ontology/diagnosis/daily', authRequired, async (req, res) => {
    try {
      await ensureGrowth();
      const result = await runDailyDiagnosis(pool, {
        tenantId: getTenantId(req),
        storeId: req.query?.store_id || req.query?.storeId || '',
        date: req.query?.date || '',
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[ontology] daily diagnosis error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/diagnosis/run', authRequired, async (req, res) => {
    try {
      await ensureGrowth();
      const result = await runDailyDiagnosis(pool, {
        tenantId: getTenantId(req),
        storeId: req.body?.store_id || req.body?.storeId || req.query?.store_id || '',
        date: req.body?.date || req.query?.date || '',
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[ontology] diagnosis run error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ontology/issues', authRequired, async (req, res) => {
    try {
      await ensureGrowth();
      const issues = await listIssues(pool, {
        tenantId: getTenantId(req),
        storeId: req.query?.store_id || req.query?.storeId || '',
      });
      return res.json({ ok: true, issues });
    } catch (e) {
      console.error('[ontology] issues list error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ontology/opportunities', authRequired, async (req, res) => {
    try {
      await ensureGrowth();
      const opportunities = await listOpportunities(pool, {
        tenantId: getTenantId(req),
        storeId: req.query?.store_id || req.query?.storeId || '',
      });
      return res.json({ ok: true, opportunities });
    } catch (e) {
      console.error('[ontology] opportunities list error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/opportunities/:id/generate-tasks', authRequired, async (req, res) => {
    try {
      await ensureGrowth();
      const result = await generateTasksForOpportunity(pool, req.params.id, {
        tenantId: getTenantId(req),
        storeId: req.body?.store_id || req.body?.storeId || req.query?.store_id || '',
        ownerUserId: req.body?.ownerUserId || req.body?.owner_user_id || '',
      });
      if (!result.ok) return res.status(404).json(result);
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[ontology] generate opportunity tasks error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/results/track', authRequired, async (req, res) => {
    try {
      await ensureGrowth();
      const result = await trackGrowthResults(pool, {
        tenantId: getTenantId(req),
        storeId: req.body?.store_id || req.body?.storeId || '',
        opportunityId: req.body?.opportunityId || req.body?.opportunity_id || '',
      });
      return res.json({ ok: true, result });
    } catch (e) {
      console.error('[ontology] result tracking error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/attribution/run', authRequired, async (req, res) => {
    try {
      await ensureGrowth();
      const attribution = await generateGrowthAttribution(pool, {
        tenantId: getTenantId(req),
        storeId: req.body?.store_id || req.body?.storeId || '',
        campaignId: req.body?.campaignId || req.body?.campaign_id || '',
        opportunityId: req.body?.opportunityId || req.body?.opportunity_id || '',
        taskId: req.body?.taskId || req.body?.task_id || '',
        attributionWindowDays: req.body?.attributionWindowDays || req.body?.attribution_window_days || 7,
        scenario: req.body?.scenario || '',
      });
      return res.json({ ok: true, attribution });
    } catch (e) {
      console.error('[ontology] growth attribution error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ontology/closed-loop-report', authRequired, async (req, res) => {
    try {
      await ensureGrowth();
      const report = await buildClosedLoopReport(pool, {
        tenantId: getTenantId(req),
        storeId: req.query?.store_id || req.query?.storeId || '',
        period: req.query?.period || '30d',
      });
      return res.json(report);
    } catch (e) {
      console.error('[ontology] closed loop report error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ontology/rules', authRequired, async (req, res) => {
    try {
      await ensureOntologyRuleConfig(pool);
      const tenantId = getTenantId(req);
      const storeId = req.query?.store_id || req.query?.storeId || '';
      const rules = await loadEffectiveRules(pool, {
        tenantId,
        storeId,
        ruleType: req.query?.rule_type || req.query?.ruleType || '',
        businessDomain: req.query?.business_domain || req.query?.businessDomain || '',
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
      return res.json({ ok: true, rules: enriched });
    } catch (e) {
      console.error('[ontology] rules list error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  if (typeof app.put === 'function') app.put('/api/ontology/rules/:rule_id', authRequired, async (req, res) => {
    try {
      await ensureOntologyRuleConfig(pool);
      const tenantId = getTenantId(req);
      const storeId = String(req.body?.store_id || req.body?.storeId || req.query?.store_id || '').trim();
      const ruleId = req.params.rule_id;
      const baseRules = await loadEffectiveRules(pool, { tenantId, storeId, ruleType: req.body?.rule_type || 'diagnosis' });
      const base = baseRules.find(rule => rule.rule_id === ruleId);
      if (!base) return res.status(404).json({ ok: false, error: 'rule_not_found' });
      const versionResult = await pool.query(
        `SELECT COALESCE(max(version),0)::int + 1 AS next_version
           FROM ontology_rules
          WHERE rule_id=$1 AND tenant_id=$2 AND COALESCE(store_id,'')=COALESCE($3,'')`,
        [ruleId, tenantId, storeId || null]
      );
      const nextVersion = Number(versionResult.rows?.[0]?.next_version || Number(base.version || 1) + 1);
      await pool.query(
        `UPDATE ontology_rules SET is_active=false, updated_at=now()
          WHERE rule_id=$1 AND tenant_id=$2 AND COALESCE(store_id,'')=COALESCE($3,'')`,
        [ruleId, tenantId, storeId || null]
      );
      const condition = req.body?.condition_json || req.body?.condition || base.condition_json || {};
      const action = req.body?.action_json || req.body?.action || base.action_json || {};
      const inserted = await pool.query(
        `INSERT INTO ontology_rules (
          rule_id, tenant_id, store_id, rule_type, rule_name, business_domain, target_metric,
          condition_json, action_json, boss_language_template, severity, priority,
          confidence_base, version, is_active, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,true,$15)
        RETURNING *`,
        [
          ruleId, tenantId, storeId || null, base.rule_type, req.body?.rule_name || base.rule_name,
          req.body?.business_domain || base.business_domain, req.body?.target_metric || base.target_metric,
          JSON.stringify(condition), JSON.stringify(action), req.body?.boss_language_template || base.boss_language_template,
          req.body?.severity || base.severity, req.body?.priority || base.priority,
          Number(req.body?.confidence_base || base.confidence_base || 0.75), nextVersion, req.user?.username || 'api',
        ]
      );
      const thresholds = req.body?.thresholds || {};
      for (const [key, value] of Object.entries(thresholds)) {
        if (value === '' || value == null) continue;
        const existingDefault = await getRuleThreshold(pool, { tenantId, storeId, ruleId, thresholdKey: key, defaultValue: Number(value) });
        await pool.query(
          `INSERT INTO ontology_rule_thresholds (rule_id, tenant_id, store_id, threshold_key, threshold_value, threshold_unit, comparator, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (rule_id, threshold_key, COALESCE(tenant_id, ''), COALESCE(store_id, ''))
           DO UPDATE SET threshold_value=EXCLUDED.threshold_value, updated_at=now(), is_active=true`,
          [ruleId, tenantId, storeId || null, key, Number(value), req.body?.threshold_units?.[key] || '', req.body?.comparators?.[key] || '', req.body?.descriptions?.[key] || `门店规则阈值 ${existingDefault}`]
        );
      }
      return res.json({ ok: true, rule: inserted.rows[0] });
    } catch (e) {
      console.error('[ontology] rule update error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ontology/rule-hits', authRequired, async (req, res) => {
    try {
      await ensureOntologyRuleConfig(pool);
      const tenantId = getTenantId(req);
      const storeId = String(req.query?.store_id || req.query?.storeId || '').trim();
      const params = [tenantId, storeId];
      const where = [`tenant_id=$1`, `($2::text='' OR store_id=$2)`];
      if (req.query?.rule_id) {
        params.push(req.query.rule_id);
        where.push(`rule_id=$${params.length}`);
      }
      if (req.query?.from) {
        params.push(req.query.from);
        where.push(`hit_at >= $${params.length}::timestamptz`);
      }
      if (req.query?.to) {
        params.push(req.query.to);
        where.push(`hit_at <= $${params.length}::timestamptz`);
      }
      const limit = Math.min(Math.max(Number(req.query?.limit || 50), 1), 200);
      params.push(limit);
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
      return res.json({ ok: true, hits: result.rows || [] });
    } catch (e) {
      console.error('[ontology] rule hits error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/rules/evaluate', authRequired, async (req, res) => {
    try {
      await ensureOntologyRuleConfig(pool);
      const result = await evaluateRules(pool, {
        tenantId: getTenantId(req),
        storeId: req.body?.store_id || req.body?.storeId || '',
        businessDomain: req.body?.business_domain || req.body?.businessDomain || '',
        ruleType: req.body?.rule_type || req.body?.ruleType || 'diagnosis',
        inputContext: req.body?.inputContext || {},
      });
      return res.json({ ok: true, ...result });
    } catch (e) {
      console.error('[ontology] rule evaluate error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/rules/:rule_id/disable', authRequired, async (req, res) => {
    try {
      await ensureOntologyRuleConfig(pool);
      const tenantId = getTenantId(req);
      const storeId = String(req.body?.store_id || req.body?.storeId || req.query?.store_id || '').trim();
      const ruleId = req.params.rule_id;
      await pool.query(
        `UPDATE ontology_rules SET is_active=false, updated_at=now()
         WHERE rule_id=$1 AND tenant_id=$2 AND COALESCE(store_id,'')=COALESCE($3,'')`,
        [ruleId, tenantId, storeId || null]
      );
      return res.json({ ok: true, ruleId, action: 'disabled' });
    } catch (e) {
      console.error('[ontology] rule disable error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/ontology/rules/:rule_id/enable', authRequired, async (req, res) => {
    try {
      await ensureOntologyRuleConfig(pool);
      const tenantId = getTenantId(req);
      const storeId = String(req.body?.store_id || req.body?.storeId || req.query?.store_id || '').trim();
      const ruleId = req.params.rule_id;
      await pool.query(
        `UPDATE ontology_rules SET is_active=true, updated_at=now()
         WHERE rule_id=$1 AND tenant_id=$2 AND COALESCE(store_id,'')=COALESCE($3,'')`,
        [ruleId, tenantId, storeId || null]
      );
      return res.json({ ok: true, ruleId, action: 'enabled' });
    } catch (e) {
      console.error('[ontology] rule enable error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/ontology/:type', authRequired, async (req, res) => {
    try {
      const { type } = req.params;
      const { id, limit } = req.query;
      const rows = await queryObject(pool, type, { id, limit });
      return res.json({ ok: true, type, rows });
    } catch (e) {
      if (String(e?.message || '').startsWith('ontology: unknown object type')) {
        return res.status(404).json({ ok: false, error: 'unknown_object_type' });
      }
      console.error('[ontology] query error:', e?.message || e);
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
