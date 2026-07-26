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

function withReqCtx(ctx, req) {
  return { ...ctx, requestId: req.requestId };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthOpsRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.get('/api/growth/weather-context', async (req, res) => {
    return send(res, await getWeatherContext(withReqCtx(ctx, req), req.query || {}));
  });

  app.get('/api/growth/active-window', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await getActiveWindow(withReqCtx(ctx, req), getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/repurchase-trigger', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await triggerRepurchase(withReqCtx(ctx, req), getGrowthTenantId(req), req.body || {}));
  });

  app.get('/api/growth/user-clusters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listUserClusters(withReqCtx(ctx, req), getGrowthTenantId(req), req.query || {}));
  });

  app.post('/api/growth/generate-selling-point', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await generateSellingPoint(withReqCtx(ctx, req), req.body || {}));
  });

  app.post('/api/growth/daily-report/send', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await sendDailyReport(withReqCtx(ctx, req), getGrowthTenantId(req), req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get('/api/growth/daily-report/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await previewDailyReport(withReqCtx(ctx, req), getGrowthTenantId(req), req.query || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get('/api/growth/content-performance', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listContentPerformance(withReqCtx(ctx, req), req.query || {}));
  });

  app.post('/api/growth/content-performance', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertContentPerformance(withReqCtx(ctx, req), req.body || {}));
  });

  app.delete('/api/growth/content-performance/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await deleteContentPerformance(withReqCtx(ctx, req), req.params.id));
  });
}
