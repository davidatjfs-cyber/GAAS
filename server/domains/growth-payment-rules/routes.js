/**
 * Payment-rules routes — thin handlers over service.js.
 * Signature preserved: registerGrowthPaymentRulesRoutes(app, pool).
 */
import { tenantContext } from '../../utils/database.js';
import {
  requireGrowthAuth,
  getGrowthOperator,
  getGrowthTenantId,
} from '../../growth-api.js';
import {
  listPaymentRules,
  upsertPaymentRule,
  deletePaymentRule,
  syncPaymentRules,
} from './service.js';

function buildCtx(pool) {
  return { pool, tenantContext };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthPaymentRulesRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.get('/api/growth/payment-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await listPaymentRules(ctx, getGrowthTenantId(req)));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/payment-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(
        res,
        await upsertPaymentRule(ctx, getGrowthTenantId(req), req.body || {}, getGrowthOperator(req))
      );
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.delete('/api/growth/payment-rules/:ruleKey', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await deletePaymentRule(ctx, req.params.ruleKey));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/payment-rules/sync', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await syncPaymentRules(ctx, getGrowthTenantId(req)));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
