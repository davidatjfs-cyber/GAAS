/**
 * Growth ops routes — thin handlers over service.js.
 * Signature preserved: registerGrowthOpsRoutes(app, pool).
 */
import { tenantContext } from '../../utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  cleanText,
  fmtYmd,
  buildGrowthDailyReport,
  getSendGrowthAlert,
} from '../../growth-api.js';
import {
  getWeatherContext,
  getActiveWindow,
  triggerRepurchase,
  listUserClusters,
  generateSellingPoint,
  sendDailyReport,
  previewDailyReport,
  listContentPerformance,
  upsertContentPerformance,
  deleteContentPerformance,
} from './service.js';

function buildCtx(pool) {
  return {
    pool,
    tenantContext,
    cleanText,
    fmtYmd,
    buildGrowthDailyReport,
    getSendGrowthAlert,
  };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthOpsRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.get('/api/growth/weather-context', async (req, res) => {
    return send(res, await getWeatherContext(ctx, req.query || {}));
  });

  app.get('/api/growth/active-window', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await getActiveWindow(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/repurchase-trigger', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await triggerRepurchase(ctx, getGrowthTenantId(req), req.body || {}));
  });

  app.get('/api/growth/user-clusters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listUserClusters(ctx, getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/generate-selling-point', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await generateSellingPoint(ctx, req.body || {}));
  });

  app.post('/api/growth/daily-report/send', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await sendDailyReport(ctx, getGrowthTenantId(req), req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get('/api/growth/daily-report/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await previewDailyReport(ctx, getGrowthTenantId(req), req.query || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get('/api/growth/content-performance', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listContentPerformance(ctx, req.query || {}));
  });

  app.post('/api/growth/content-performance', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertContentPerformance(ctx, req.body || {}));
  });

  app.delete('/api/growth/content-performance/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await deleteContentPerformance(ctx, req.params.id));
  });
}
