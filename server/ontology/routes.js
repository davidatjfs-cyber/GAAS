/**
 * Ontology 路由 — HTTP 绑定层。业务 SQL/编排见 ./service-routes.js。
 * 沿用 store-diagnosis.js#registerDiagnosisRoutes 的注册约定。
 */

import { listObjectTypes } from './objects.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'ontology', handler: 'routes' });
import { queryObject } from './query.js';
import {
  generateActionPlanFromInsights,
  generateBossSummary,
  getActionResultMappings,
  getBusinessDomains,
  getIssueActionMappings,
  getMetricIssueMappings,
  getRuleIdentities,
  inferIssuesFromMetrics,
} from './business-ontology-engine.js';
import { createTaskDraftsFromOntologyInsights } from './task-draft-adapter.js';
import { createOntologyTaskFromDraft } from './ontology-task-adapter.js';
import { getProductKnowledgeOntology, searchProductKnowledgeOntology } from './product-knowledge-ontology.js';
import {
  disableOntologyRule,
  enableOntologyRule,
  evaluateOntologyRules,
  generateOpportunityTasks,
  getClosedLoopReport,
  getDailyDiagnosis,
  getIssues,
  getOpportunities,
  inferMarketingFromBody,
  listOntologyRuleHits,
  listOntologyRules,
  runAttribution,
  runDailyDiagnosisAll,
  runDiagnosis,
  runMetricLint,
  trackResults,
  updateOntologyRule,
} from './service-routes.js';

function withOntologyError(logLabel, handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (e) {
      log.error({ msg: 'ontology_route_error', label: logLabel, err: e?.message || String(e) });
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  };
}

export function registerOntologyRoutes(app, pool, authRequired) {
  const tenantId = (req) => String(req.tenantId || req.user?.tenant_id || req.query?.tenant_id || req.body?.tenant_id || 'default').trim() || 'default';
  const qStore = (req) => req.query?.store_id || req.query?.storeId || '';
  const bStore = (req) => req.body?.store_id || req.body?.storeId || req.query?.store_id || '';

  app.get('/api/ontology/types', authRequired, async (_req, res) => res.json({ ok: true, types: listObjectTypes() }));
  app.get('/api/ontology/business/domains', authRequired, async (_req, res) => res.json({ ok: true, domains: getBusinessDomains() }));
  app.get('/api/ontology/product-knowledge', authRequired, async (_req, res) => res.json({ ok: true, ...getProductKnowledgeOntology() }));
  app.get('/api/ontology/product-knowledge/search', authRequired, async (req, res) => {
    const query = String(req.query?.q || req.query?.query || '').trim();
    const limit = Math.max(1, Math.min(Number(req.query?.limit || 5), 20));
    return res.json({ ok: true, ...searchProductKnowledgeOntology(query, limit) });
  });
  app.get('/api/ontology/business/mappings', authRequired, async (_req, res) => res.json({
    ok: true,
    metricIssueMappings: getMetricIssueMappings(),
    issueActionMappings: getIssueActionMappings(),
    actionResultMappings: getActionResultMappings(),
    ruleIdentities: getRuleIdentities(),
  }));

  app.post('/api/ontology/business/infer', authRequired, withOntologyError('[ontology] business infer error:', async (req, res) => {
    const insights = inferIssuesFromMetrics(req.body?.metricsInput || req.body || {});
    return res.json({ ok: true, insights, bossSummary: generateBossSummary(insights), actionPlan: generateActionPlanFromInsights(insights) });
  }));
  app.post('/api/ontology/business/task-drafts', authRequired, withOntologyError('[ontology] task draft error:', async (req, res) => {
    const insights = req.body?.insights;
    return res.json({ ok: true, taskDrafts: createTaskDraftsFromOntologyInsights(Array.isArray(insights) ? insights : (req.body?.metricsInput || {})) });
  }));
  app.post('/api/ontology/business/create-task-from-draft', authRequired, withOntologyError('[ontology] create task from draft error:', async (req, res) => {
    if (!req.body?.taskDraft) return res.status(400).json({ ok: false, error: 'taskDraft_required' });
    const result = await createOntologyTaskFromDraft(pool, req.body.taskDraft, {
      reportType: req.body?.reportType || '', storeId: req.body?.storeId || '',
      ownerUserId: req.body?.ownerUserId || '', tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    return res.json({ ok: true, ...result });
  }));
  app.post('/api/ontology/business/infer-marketing', authRequired, withOntologyError('[ontology] marketing infer error:', async (req, res) => {
    return res.json({ ok: true, ...inferMarketingFromBody(req.body) });
  }));
  app.get('/api/ontology/metric-lint', authRequired, withOntologyError('[ontology] metric lint error:', async (_req, res) => {
    return res.json({ ok: true, ...await runMetricLint(pool) });
  }));

  app.get('/api/ontology/diagnosis/daily', authRequired, withOntologyError('[ontology] daily diagnosis error:', async (req, res) => {
    return res.json({ ok: true, ...await getDailyDiagnosis(pool, { tenantId: tenantId(req), storeId: qStore(req), date: req.query?.date || '' }) });
  }));
  app.post('/api/ontology/diagnosis/run', authRequired, withOntologyError('[ontology] diagnosis run error:', async (req, res) => {
    return res.json({ ok: true, ...await runDiagnosis(pool, { tenantId: tenantId(req), storeId: bStore(req), date: req.body?.date || req.query?.date || '' }) });
  }));
  // 手动触发「全门店日更」：sync + 每店诊断。定时任务同逻辑；force 不依赖 08:00 窗口。
  app.post('/api/ontology/diagnosis/run-daily', authRequired, withOntologyError('[ontology] run-daily error:', async (req, res) => {
    return res.json({ ok: true, ...await runDailyDiagnosisAll(pool, { tenantId: tenantId(req), date: req.body?.date || req.query?.date || '', storeIds: req.body?.store_ids }) });
  }));
  app.get('/api/ontology/issues', authRequired, withOntologyError('[ontology] issues list error:', async (req, res) => {
    return res.json({ ok: true, issues: await getIssues(pool, { tenantId: tenantId(req), storeId: qStore(req) }) });
  }));
  app.get('/api/ontology/opportunities', authRequired, withOntologyError('[ontology] opportunities list error:', async (req, res) => {
    return res.json({ ok: true, opportunities: await getOpportunities(pool, { tenantId: tenantId(req), storeId: qStore(req) }) });
  }));
  app.post('/api/ontology/opportunities/:id/generate-tasks', authRequired, withOntologyError('[ontology] generate opportunity tasks error:', async (req, res) => {
    const result = await generateOpportunityTasks(pool, req.params.id, {
      tenantId: tenantId(req), storeId: bStore(req),
      ownerUserId: req.body?.ownerUserId || req.body?.owner_user_id || '',
    });
    if (!result.ok) return res.status(404).json(result);
    return res.json({ ok: true, ...result });
  }));
  app.post('/api/ontology/results/track', authRequired, withOntologyError('[ontology] result tracking error:', async (req, res) => {
    const result = await trackResults(pool, {
      tenantId: tenantId(req), storeId: req.body?.store_id || req.body?.storeId || '',
      opportunityId: req.body?.opportunityId || req.body?.opportunity_id || '',
    });
    return res.json({ ok: true, result });
  }));
  app.post('/api/ontology/attribution/run', authRequired, withOntologyError('[ontology] growth attribution error:', async (req, res) => {
    const b = req.body || {};
    const attribution = await runAttribution(pool, {
      tenantId: tenantId(req), storeId: b.store_id || b.storeId || '',
      campaignId: b.campaignId || b.campaign_id || '', opportunityId: b.opportunityId || b.opportunity_id || '',
      taskId: b.taskId || b.task_id || '', attributionWindowDays: b.attributionWindowDays || b.attribution_window_days || 7,
      scenario: b.scenario || '',
    });
    return res.json({ ok: true, attribution });
  }));
  app.get('/api/ontology/closed-loop-report', authRequired, withOntologyError('[ontology] closed loop report error:', async (req, res) => {
    return res.json(await getClosedLoopReport(pool, { tenantId: tenantId(req), storeId: qStore(req), period: req.query?.period || '30d' }));
  }));
  // 供 agents-service-v2 客户生命周期扫描；X-Miniprogram-Sync-Secret，不复用 JWT authRequired。
  app.post('/api/internal/ontology/closed-loop-report', withOntologyError('[ontology] internal closed loop report error:', async (req, res) => {
    const secret = String(req.headers['x-miniprogram-sync-secret'] || '');
    const expected = String(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '');
    if (!expected || secret !== expected) return res.status(401).json({ ok: false, error: 'unauthorized' });
    return res.json(await getClosedLoopReport(pool, { tenantId: req.body?.tenant_id || '', storeId: req.body?.store_id || '', period: req.body?.period || '30d' }));
  }));

  app.get('/api/ontology/rules', authRequired, withOntologyError('[ontology] rules list error:', async (req, res) => {
    return res.json({ ok: true, rules: await listOntologyRules(pool, {
      tenantId: tenantId(req), storeId: qStore(req),
      ruleType: req.query?.rule_type || req.query?.ruleType || '',
      businessDomain: req.query?.business_domain || req.query?.businessDomain || '',
    }) });
  }));
  if (typeof app.put === 'function') app.put('/api/ontology/rules/:rule_id', authRequired, withOntologyError('[ontology] rule update error:', async (req, res) => {
    const result = await updateOntologyRule(pool, {
      tenantId: tenantId(req), storeId: req.body?.store_id || req.body?.storeId || req.query?.store_id || '',
      ruleId: req.params.rule_id, body: req.body || {}, username: req.user?.username || 'api',
    });
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  }));
  app.get('/api/ontology/rule-hits', authRequired, withOntologyError('[ontology] rule hits error:', async (req, res) => {
    return res.json({ ok: true, hits: await listOntologyRuleHits(pool, {
      tenantId: tenantId(req), storeId: qStore(req), ruleId: req.query?.rule_id || '',
      from: req.query?.from || '', to: req.query?.to || '', limit: req.query?.limit || 50,
    }) });
  }));
  app.post('/api/ontology/rules/evaluate', authRequired, withOntologyError('[ontology] rule evaluate error:', async (req, res) => {
    const b = req.body || {};
    return res.json({ ok: true, ...await evaluateOntologyRules(pool, {
      tenantId: tenantId(req), storeId: b.store_id || b.storeId || '',
      businessDomain: b.business_domain || b.businessDomain || '',
      ruleType: b.rule_type || b.ruleType || 'diagnosis', inputContext: b.inputContext || {},
    }) });
  }));
  app.post('/api/ontology/rules/:rule_id/disable', authRequired, withOntologyError('[ontology] rule disable error:', async (req, res) => {
    return res.json(await disableOntologyRule(pool, { tenantId: tenantId(req), storeId: bStore(req), ruleId: req.params.rule_id }));
  }));
  app.post('/api/ontology/rules/:rule_id/enable', authRequired, withOntologyError('[ontology] rule enable error:', async (req, res) => {
    return res.json(await enableOntologyRule(pool, { tenantId: tenantId(req), storeId: bStore(req), ruleId: req.params.rule_id }));
  }));

  app.get('/api/ontology/:type', authRequired, withOntologyError('[ontology] query error:', async (req, res) => {
    try {
      const rows = await queryObject(pool, req.params.type, { id: req.query.id, limit: req.query.limit });
      return res.json({ ok: true, type: req.params.type, rows });
    } catch (e) {
      if (String(e?.message || '').startsWith('ontology: unknown object type')) {
        return res.status(404).json({ ok: false, error: 'unknown_object_type' });
      }
      throw e;
    }
  }));
}
