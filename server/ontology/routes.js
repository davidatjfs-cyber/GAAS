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

export function registerOntologyRoutes(app, pool, authRequired) {
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
