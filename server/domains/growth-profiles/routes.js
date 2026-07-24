/**
 * Growth profiles + strategy context routes — thin handlers over service.js.
 * Signature preserved: registerGrowthProfilesRoutes(app, pool).
 */
import { tenantContext } from '../../utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  recomputeCustomerProfiles,
  upsertCustomer,
  parseOccurredAt,
  resolveTenantIdForStore,
} from '../../growth-api.js';
import {
  listStoreProfiles,
  upsertStoreProfile,
  listCustomerProfiles,
  recomputeProfiles,
  listProfileSignals,
  createProfileSignal,
  listStoreConstraints,
  upsertStoreConstraint,
  getStrategyContext,
} from './service.js';

function buildCtx(pool) {
  return {
    pool,
    tenantContext,
    recomputeCustomerProfiles,
    upsertCustomer,
    parseOccurredAt,
    resolveTenantIdForStore,
  };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthProfilesRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.get('/api/growth/store-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listStoreProfiles(ctx, getGrowthTenantId(req)));
  });

  app.post('/api/growth/store-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertStoreProfile(ctx, getGrowthTenantId(req), req.body || {}));
  });

  app.get('/api/growth/customer-profiles', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listCustomerProfiles(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/customer-profiles/recompute', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await recomputeProfiles(ctx, getGrowthTenantId(req), req.body || {}));
  });

  app.get('/api/growth/profile-signals', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listProfileSignals(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/profile-signals', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await createProfileSignal(ctx, getGrowthTenantId(req), req.body || {}));
  });

  app.get('/api/growth/store-constraints', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listStoreConstraints(ctx, req.query || {}));
  });

  app.post('/api/growth/store-constraints', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertStoreConstraint(ctx, req.body || {}));
  });

  app.get('/api/growth/strategy-context', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await getStrategyContext(ctx, req.query.store_id, req.query.channel, req.query.audience)
    );
  });

  app.post('/api/growth/strategy-context', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    return send(res, await getStrategyContext(ctx, b.store_id, b.channel, b.audience));
  });
}
