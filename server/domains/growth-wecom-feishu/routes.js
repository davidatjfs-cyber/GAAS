/**
 * WeCom + Feishu config routes — thin handlers over service.js.
 * Signature preserved: registerGrowthWecomFeishuRoutes(app, pool).
 * Also exports syncWecomContactsForStore for growth-api timer injection.
 */
import { tenantContext } from '../../utils/database.js';
import {
  requireGrowthAuth,
  resolveTenantIdForStore,
  getWecomConfig,
  getStoreWecomConfig,
  getAllStoreWecomConfigs,
  getWecomAccessToken,
  resetGrowthWecomTokenCache,
  clearStoreWecomTokenCache,
  upsertDeliveryLog,
  insertGrowthEvent,
  setSyncWecomContactsForStore,
} from '../../growth-api.js';
import {
  syncWecomContactsForStore as syncWecomContactsForStoreSvc,
  getWecomConfigEndpoint,
  saveWecomConfig,
  handleWecomCallback,
  listStoreWecomConfigs,
  upsertStoreWecomConfig,
  deleteStoreWecomConfig,
  syncWecomContactsEndpoint,
  getFeishuConfig,
  saveFeishuConfig,
} from './service.js';

function buildCtx() {
  return {
    tenantContext,
    resolveTenantIdForStore,
    getWecomConfig,
    getStoreWecomConfig,
    getAllStoreWecomConfigs,
    getWecomAccessToken,
    resetGrowthWecomTokenCache,
    clearStoreWecomTokenCache,
    upsertDeliveryLog,
    insertGrowthEvent,
  };
}

const _ctx = buildCtx();

/** Public API for growth-api timer + manual sync — same signature as pre-peel. */
export async function syncWecomContactsForStore(pool, storeConfig) {
  return syncWecomContactsForStoreSvc(_ctx, pool, storeConfig);
}

setSyncWecomContactsForStore(syncWecomContactsForStore);

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthWecomFeishuRoutes(app, pool) {
  const ctx = _ctx;

  app.get('/api/growth/wecom-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await getWecomConfigEndpoint(ctx, pool));
  });

  app.post('/api/growth/wecom-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await saveWecomConfig(ctx, pool, req.body || {}));
  });

  app.post('/api/growth/wecom/callback', async (req, res) => {
    return send(res, await handleWecomCallback(ctx, pool, req.body || {}, req.headers || {}));
  });

  app.get('/api/growth/store-wecom-configs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listStoreWecomConfigs(ctx, pool));
  });

  app.post('/api/growth/store-wecom-configs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertStoreWecomConfig(ctx, pool, req.body || {}));
  });

  app.delete('/api/growth/store-wecom-configs/:storeId', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await deleteStoreWecomConfig(ctx, pool, req.params.storeId));
  });

  app.post('/api/growth/sync-wecom-contacts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await syncWecomContactsEndpoint(ctx, pool, req.body || {}));
  });

  app.get('/api/growth/feishu-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await getFeishuConfig(ctx, pool));
  });

  app.post('/api/growth/feishu-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await saveFeishuConfig(ctx, pool, req.body || {}));
  });
}
