/**
 * Growth queries routes — thin handlers over service.js.
 * Signature preserved: registerGrowthQueriesRoutes(app, pool).
 */
import { tenantContext, getActiveTenantIds } from '../../utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  appendExecutionLog,
} from '../../growth-api.js';
import {
  listCustomers,
  listEvents,
  listCampaigns,
  listRedemptions,
  handleFeishuCallback,
  semanticParse,
  semanticWriteback,
} from './service.js';

function buildCtx(pool) {
  return {
    pool,
    tenantContext,
    getActiveTenantIds,
    appendExecutionLog,
  };
}

function withReqCtx(ctx, req) {
  return { ...ctx, requestId: req.requestId };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthQueriesRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.get('/api/growth/customers', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listCustomers(withReqCtx(ctx, req), getGrowthTenantId(req), req.query || {}));
  });

  app.get('/api/growth/events', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listEvents(withReqCtx(ctx, req), getGrowthTenantId(req), req.query || {}));
  });

  app.get('/api/growth/campaigns', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listCampaigns(withReqCtx(ctx, req), getGrowthTenantId(req), req.query || {}));
  });

  app.get('/api/growth/redemptions', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listRedemptions(withReqCtx(ctx, req), getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/feishu-callback', async (req, res) => {
    return send(res, await handleFeishuCallback(withReqCtx(ctx, req), req.body || {}, req.headers || {}));
  });

  app.post('/api/growth/semantic-parse', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await semanticParse(withReqCtx(ctx, req), req.body || {}));
  });

  app.post('/api/growth/semantic-writeback', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await semanticWriteback(withReqCtx(ctx, req), getGrowthTenantId(req), req.body || {}));
  });
}
