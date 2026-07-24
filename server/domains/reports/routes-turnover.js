/**
 * Turnover analysis report — /api/reports/turnover
 * Handlers stay thin; business logic lives in service-turnover.js.
 */
import { pool, legacyAnalyticsGate } from './helpers.js';
import { getTurnoverReportPayload } from './service-turnover.js';

function sendServiceResult(res, result) {
  if (!result.ok) {
    const body = { error: result.error };
    if (result.message) body.message = result.message;
    return res.status(result.status).json(body);
  }
  return res.json(result.payload);
}

export function registerReportsTurnoverRoutes(app, deps) {
  const { authRequired } = deps;
  const ctx = { pool, ...deps };

  app.get('/api/reports/turnover', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQ = String(req.query?.store || '').trim();
    if (!(await legacyAnalyticsGate(req, res, storeQ))) return;

    const month = String(req.query?.month || '').trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'missing_month' });

    const result = await getTurnoverReportPayload(ctx, {
      month,
      storeQ,
      role,
      username,
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
      allowedStores: Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [],
      currentStore: String(req.user?.current_store || '').trim(),
    });
    return sendServiceResult(res, result);
  });
}
