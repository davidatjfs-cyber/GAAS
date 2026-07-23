import { tenantContext } from '../../utils/database.js';
import { authPhaseApi } from '../growth-phase-auth.js';
import {
  createMarketingTemplate,
  deleteMarketingTemplate,
  listCampaignPlans,
  listMarketingTemplates,
  listStoreRankings,
  patchCampaignPlanStatus,
  upsertCampaignPlan,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {{
 *   pool: any,
 *   requirePhaseAuth: Function,
 *   getPhaseTenantId: Function,
 *   executeGrowthActionRecord: Function,
 * }} deps
 */
export function registerGrowthCampaignRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId, executeGrowthActionRecord } = deps;

  app.post('/api/growth/campaign-plans', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    const tid = getPhaseTenantId(req);
    try {
      const plan = await tenantContext.run(tid, () => upsertCampaignPlan(pool, tid, req.body || {}));
      return res.json({ ok: true, plan });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/campaign-plans', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const plans = await tenantContext.run(getPhaseTenantId(req), () =>
        listCampaignPlans(pool, { storeId: req.query.store_id, status: req.query.status })
      );
      return res.json({ ok: true, plans });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/marketing-templates', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const templates = await listMarketingTemplates(pool);
      return res.json({ ok: true, templates });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/marketing-templates', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const template = await createMarketingTemplate(pool, getPhaseTenantId(req), req.body || {});
      return res.json({ ok: true, template });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.patch('/api/growth/campaign-plans/:id/status', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });
    const tid = getPhaseTenantId(req);
    try {
      const result = await tenantContext.run(tid, () =>
        patchCampaignPlanStatus(
          pool,
          tid,
          { id: req.params.id, status: req.body?.status, authUser: auth.user },
          { executeGrowthActionRecord }
        )
      );
      return res.json({ ok: true, ...result });
    } catch (e) {
      if (e?.code === 'invalid_status') return res.status(400).json({ ok: false, error: 'invalid_status' });
      if (e?.code === 'not_found') return res.status(404).json({ ok: false, error: 'not_found' });
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.delete('/api/growth/marketing-templates/:id', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      await deleteMarketingTemplate(pool, req.params.id);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/store-rankings', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const rankings = await tenantContext.run(getPhaseTenantId(req), () => listStoreRankings(pool, req.query.days));
      return res.json({ ok: true, rankings });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
