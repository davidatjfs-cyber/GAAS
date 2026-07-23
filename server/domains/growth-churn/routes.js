import { tenantContext } from '../../utils/database.js';
import { authPhaseApi, cleanText } from '../growth-phase-auth.js';
import { computeChurnScores, listChurnPredictions } from './service.js';

/**
 * @param {import('express').Express} app
 * @param {{
 *   pool: any,
 *   requirePhaseAuth: (req, res)=>boolean,
 *   getPhaseTenantId: (req)=>string,
 * }} deps
 */
export function registerGrowthChurnRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId } = deps;

  app.get('/api/growth/churn-predictions', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const result = await tenantContext.run(getPhaseTenantId(req), () =>
        listChurnPredictions(pool, {
          storeCode: req.query.store_code,
          riskLevel: req.query.risk_level,
          predDate: req.query.prediction_date,
          limit: req.query.limit,
        })
      );
      return res.json({ ok: true, predictions: result.predictions, summary: result.summary });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/churn-predictions/compute', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
    const storeCode = cleanText(req.body?.store_code || req.query?.store_code || '', 128);
    try {
      const result = await tenantContext.run(getPhaseTenantId(req), () =>
        computeChurnScores(pool, storeCode, getPhaseTenantId(req))
      );
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
