/**
 * Content library routes (public channels / assets / posters).
 * Domain export: registerGrowthContentLibraryRoutes.
 * Root growth-content-routes.js re-exports as registerGrowthContentRoutes for index.js.
 */
import { tenantContext, resolveTenantIdDefault } from '../../utils/database.js';
import {
  requireGrowthAuth,
  requireGrowthAdminRole,
  getGrowthTenantId,
  resolveTenantIdForStore,
  parseOccurredAt,
} from '../../growth-api.js';
import {
  listPublicChannels,
  upsertPublicChannel,
  listPublicPromoTasks,
  upsertPublicPromoTask,
  listCreativeAssets,
  upsertCreativeAsset,
  listPosterTemplates,
  upsertPosterTemplate,
  deleteById,
  listGeneratedPosters,
  upsertGeneratedPoster,
  listContentLibrary,
} from './service.js';

function buildCtx(pool) {
  return {
    pool,
    tenantContext,
    resolveTenantIdDefault,
    resolveTenantIdForStore,
    parseOccurredAt,
  };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthContentLibraryRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.get('/api/growth/public-channels', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listPublicChannels(ctx));
  });

  app.post('/api/growth/public-channels', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertPublicChannel(ctx, req.body || {}));
  });

  app.get('/api/growth/public-promo-tasks', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listPublicPromoTasks(ctx, req.query || {}));
  });

  app.post('/api/growth/public-promo-tasks', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertPublicPromoTask(ctx, req.body || {}));
  });

  app.get('/api/growth/creative-assets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listCreativeAssets(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/creative-assets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertCreativeAsset(ctx, getGrowthTenantId(req), req.body || {}));
  });

  app.get('/api/growth/poster-templates', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listPosterTemplates(ctx));
  });

  app.post('/api/growth/poster-templates', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertPosterTemplate(ctx, req.body || {}));
  });

  app.delete('/api/growth/poster-templates/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    if (!requireGrowthAdminRole(req, res)) return;
    return send(res, await deleteById(ctx, 'poster_templates', req.params.id));
  });

  app.delete('/api/growth/creative-assets/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    if (!requireGrowthAdminRole(req, res)) return;
    return send(res, await deleteById(ctx, 'creative_assets', req.params.id));
  });

  app.get('/api/growth/generated-posters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listGeneratedPosters(ctx, req.query || {}));
  });

  app.post('/api/growth/generated-posters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertGeneratedPoster(ctx, req.body || {}));
  });

  app.get('/api/growth/content-library', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listContentLibrary(ctx, req.query || {}));
  });

  app.delete('/api/growth/generated-posters/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    if (!requireGrowthAdminRole(req, res)) return;
    return send(res, await deleteById(ctx, 'generated_posters', req.params.id));
  });
}
