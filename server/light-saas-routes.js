/**
 * 极轻模式 Phase ③④⑤⑥ 平台路由汇总
 */
import { buildExecutionLedger } from './services/execution-ledger-service.js';
import {
  startOnboarding,
  getOnboardingByTenant,
  refreshOnboarding,
  completeOnboardingStep,
  ONBOARDING_STEPS,
} from './services/tenant-onboarding-service.js';
import { createDemandRequest, listDemandRequests, DEMAND_VERDICTS } from './services/demand-governance-service.js';
import { listHealthFaqs } from './services/tenant-health-faq.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'light-saas' });

export function registerLightSaasRoutes(app, pool, platformAdminRequired) {
  if (!platformAdminRequired) return;

  // ⑥ 未执行责任台账
  app.get('/api/admin/health-center/execution-ledger', platformAdminRequired, async (req, res) => {
    try {
      const tenantId = String(req.query?.tenant_id || '').trim();
      if (!tenantId) return res.status(400).json({ ok: false, error: 'tenant_id_required' });
      const data = await buildExecutionLedger(pool, {
        tenantId,
        storeId: req.query?.store_id,
        dateFrom: req.query?.date_from,
        dateTo: req.query?.date_to,
      });
      return res.json(data);
    } catch (e) {
      log.error({ msg: 'execution_ledger_failed', err: e?.message || String(e) });
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message });
    }
  });

  // ③ 上线向导
  app.get('/api/admin/tenants/:tenantId/onboarding', platformAdminRequired, async (req, res) => {
    try {
      const data = await getOnboardingByTenant(pool, req.params.tenantId);
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'onboarding_get_failed' });
    }
  });
  app.post('/api/admin/tenants/:tenantId/onboarding/start', platformAdminRequired, async (req, res) => {
    try {
      const data = await startOnboarding(pool, {
        tenantId: req.params.tenantId,
        startedBy: req.platformAdmin?.username || req.user?.username || '',
      });
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'onboarding_start_failed' });
    }
  });
  app.post('/api/admin/tenants/:tenantId/onboarding/refresh', platformAdminRequired, async (req, res) => {
    try {
      const cur = await getOnboardingByTenant(pool, req.params.tenantId);
      if (!cur.run) {
        const started = await startOnboarding(pool, { tenantId: req.params.tenantId, startedBy: req.platformAdmin?.username || '' });
        return res.json(started);
      }
      const data = await refreshOnboarding(pool, cur.run.id);
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'onboarding_refresh_failed' });
    }
  });
  app.post('/api/admin/tenants/:tenantId/onboarding/steps/:stepKey/complete', platformAdminRequired, async (req, res) => {
    try {
      const cur = await getOnboardingByTenant(pool, req.params.tenantId);
      if (!cur.run) return res.status(404).json({ ok: false, error: 'run_not_found' });
      const data = await completeOnboardingStep(pool, cur.run.id, req.params.stepKey, {
        completedBy: req.platformAdmin?.username || 'platform_admin',
        note: req.body?.note,
      });
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'step_complete_failed' });
    }
  });
  app.get('/api/admin/onboarding/steps', platformAdminRequired, (_req, res) => {
    res.json({ ok: true, steps: ONBOARDING_STEPS });
  });

  // ④ FAQ 门户（增强）
  app.get('/api/admin/support/faqs', platformAdminRequired, (req, res) => {
    const q = String(req.query?.q || '').trim().toLowerCase();
    let faqs = listHealthFaqs();
    if (q) {
      faqs = faqs.filter((f) =>
        [f.title, f.summary, f.category, ...(f.steps || [])].join(' ').toLowerCase().includes(q)
      );
    }
    const categories = [...new Set(faqs.map((f) => f.category).filter(Boolean))];
    res.json({ ok: true, faqs, categories, total: faqs.length });
  });

  // ⑤ 需求治理
  app.get('/api/admin/demand-requests', platformAdminRequired, async (req, res) => {
    try {
      const data = await listDemandRequests(pool, { tenant_id: req.query?.tenant_id });
      return res.json(data);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });
  app.post('/api/admin/demand-requests', platformAdminRequired, async (req, res) => {
    try {
      const data = await createDemandRequest(pool, {
        ...(req.body || {}),
        created_by: req.platformAdmin?.username || req.user?.username || '',
      });
      return res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });
  app.get('/api/admin/demand-requests/verdicts', platformAdminRequired, (_req, res) => {
    res.json({ ok: true, verdicts: DEMAND_VERDICTS });
  });
}
