/**
 * Growth metrics/events/alerts/ABC routes — thin handlers over service.js.
 * Signature preserved: registerGrowthMetricsRoutes(app, pool).
 */
import { runForActiveTenants, tenantContext } from '../../utils/database.js';
import {
  requireGrowthAuth,
  getGrowthOperator,
  getGrowthTenantId,
  resolveTenantIdForStore,
  upsertCustomer,
  recomputeDiningSegments,
  loadRuleCandidates,
  ABC_ROTATION_ORDER,
  deriveAbcStep,
} from '../../growth-api.js';
import { verifyServerTenantBinding } from '../../middleware/server-tenant-binding.js';
import {
  recomputeSegments,
  ingestMiniprogramEvent,
  triggerMetricsRecompute,
  posConsumption,
  listMetrics,
  listAlerts,
  upsertAlert,
  resolveAlert,
  abcDistribution,
  abcBlacklistSummary,
} from './service.js';

function buildCtx(pool) {
  return {
    pool,
    tenantContext,
    resolveTenantIdForStore,
    verifyServerTenantBinding,
    upsertCustomer,
    recomputeDiningSegments,
    loadRuleCandidates,
    ABC_ROTATION_ORDER,
    deriveAbcStep,
  };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthMetricsRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.post('/api/growth/segments/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await recomputeSegments(ctx, getGrowthTenantId(req)));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  if (!globalThis.__growthSegmentTimer) {
    globalThis.__growthSegmentTimer = setInterval(() => {
      runForActiveTenants(() => recomputeDiningSegments(pool)).catch((e) =>
        console.warn('[segments] recompute failed:', e?.message)
      );
    }, 24 * 60 * 60 * 1000);
    setTimeout(() => {
      runForActiveTenants(() => recomputeDiningSegments(pool)).catch((e) =>
        console.warn('[segments] initial recompute failed:', e?.message)
      );
    }, 30000);
  }

  app.post('/api/miniprogram/events', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return send(res, await ingestMiniprogramEvent(ctx, { body, req }));
  });

  app.post('/api/growth/metrics/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await triggerMetricsRecompute(ctx, getGrowthTenantId(req), req.body?.days || 7)
    );
  });

  app.post('/api/growth/pos/consumption', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await posConsumption(ctx, {
        body: req.body || {},
        headers: req.headers || {},
        tenantIdFromAuth: getGrowthTenantId(req),
        req,
      })
    );
  });

  app.get('/api/growth/metrics', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listMetrics(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.get('/api/growth/alerts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listAlerts(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/alerts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertAlert(ctx, getGrowthTenantId(req), req.body || {}));
  });

  app.post('/api/growth/alerts/:alertKey/resolve', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const operator = getGrowthOperator(req);
    return send(
      res,
      await resolveAlert(ctx, getGrowthTenantId(req), req.params.alertKey, operator.username)
    );
  });

  app.get('/api/growth/campaign/:campaignKey/abc-distribution', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await abcDistribution(ctx, getGrowthTenantId(req), req.params.campaignKey));
  });

  app.get('/api/growth/abc-blacklist-summary', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await abcBlacklistSummary(ctx, getGrowthTenantId(req)));
  });
}
