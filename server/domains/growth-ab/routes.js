import { tenantContext } from '../../utils/database.js';
import { authPhaseApi } from '../growth-phase-auth.js';
import {
  createAbTest,
  createLearning,
  createPriceTest,
  listAbTemplates,
  listAbTests,
  listLearnings,
  listPriceTests,
  promoteAbTest,
  refreshAbTest,
  seedLearnings,
  submitAbTestResults,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {{
 *   pool: any,
 *   requirePhaseAuth: (req, res)=>boolean,
 *   getPhaseTenantId: (req)=>string,
 * }} deps
 */
export function registerGrowthAbRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId } = deps;

  app.get('/api/growth/ab-templates', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    return res.json({ ok: true, templates: listAbTemplates() });
  });

  app.get('/api/growth/ab-tests', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const tasks = await tenantContext.run(getPhaseTenantId(req), () =>
        listAbTests(pool, getPhaseTenantId(req), {
          storeCode: req.query.store_code,
          status: req.query.status,
        })
      );
      return res.json({ ok: true, tasks });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/ab-tests', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'unauthorized' });
    try {
      const task = await tenantContext.run(getPhaseTenantId(req), () =>
        createAbTest(pool, getPhaseTenantId(req), req.body || {}, auth.user)
      );
      return res.json({ ok: true, task });
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ ok: false, error: e?.code || 'server_error', message: e?.message || undefined });
    }
  });

  app.post('/api/growth/ab-tests/:id/results', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'unauthorized' });
    try {
      const result = await tenantContext.run(getPhaseTenantId(req), () =>
        submitAbTestResults(pool, getPhaseTenantId(req), req.params.id, req.body || {})
      );
      return res.json({ ok: true, ...result });
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ ok: false, error: e?.code || 'server_error', message: e?.message || undefined });
    }
  });

  app.post('/api/growth/ab-tests/:id/refresh', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'unauthorized' });
    try {
      const result = await tenantContext.run(getPhaseTenantId(req), () =>
        refreshAbTest(pool, getPhaseTenantId(req), req.params.id)
      );
      return res.json({ ok: true, ...result });
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ ok: false, error: e?.code || 'server_error', message: e?.message || undefined });
    }
  });

  app.post('/api/growth/ab-tests/:id/promote', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'unauthorized' });
    try {
      const result = await tenantContext.run(getPhaseTenantId(req), () =>
        promoteAbTest(pool, getPhaseTenantId(req), req.params.id, auth.user?.username)
      );
      if (!result.ok) {
        const status = result.error === 'target_rule_not_found' ? 404 : 400;
        return res.status(status).json(result);
      }
      return res.json(result);
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ ok: false, error: e?.code || 'server_error', message: e?.message || undefined });
    }
  });

  app.get('/api/growth/learnings', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const learnings = await tenantContext.run(getPhaseTenantId(req), () =>
        listLearnings(pool, {
          storeCode: req.query.store_code,
          channel: req.query.channel,
          limit: req.query.limit,
        })
      );
      return res.json({ ok: true, learnings });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/learnings', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
    try {
      const learning = await tenantContext.run(getPhaseTenantId(req), () =>
        createLearning(pool, getPhaseTenantId(req), req.body || {})
      );
      return res.json({ ok: true, learning });
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ ok: false, error: e?.code || 'server_error', message: e?.message || undefined });
    }
  });

  app.post('/api/growth/learnings/seed', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
    try {
      const result = await tenantContext.run(getPhaseTenantId(req), () =>
        seedLearnings(pool, getPhaseTenantId(req))
      );
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/price-tests', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const tasks = await tenantContext.run(getPhaseTenantId(req), () =>
        listPriceTests(pool, getPhaseTenantId(req), {
          storeCode: req.query.store_code,
          status: req.query.status,
        })
      );
      return res.json({ ok: true, tasks });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/price-tests', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
    try {
      const task = await tenantContext.run(getPhaseTenantId(req), () =>
        createPriceTest(pool, getPhaseTenantId(req), req.body || {}, auth.user)
      );
      return res.json({ ok: true, task });
    } catch (e) {
      const status = e?.status || 500;
      return res.status(status).json({ ok: false, error: e?.code || 'server_error', message: e?.message || undefined });
    }
  });
}
