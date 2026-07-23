import { tenantContext } from '../../utils/database.js';
import { authPhaseApi, cleanText } from '../growth-phase-auth.js';
import {
  generateMenuHealthReport,
  getMenuHealthReportsByMonth,
  listMenuHealthReports,
  safeMonthOnly,
} from './service.js';

function todayShanghaiYmd() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

/**
 * @param {import('express').Express} app
 * @param {{
 *   pool: any,
 *   requirePhaseAuth: (req, res)=>boolean,
 *   getPhaseTenantId: (req)=>string,
 * }} deps
 */
export function registerGrowthMenuHealthRoutes(app, deps) {
  const { pool, requirePhaseAuth, getPhaseTenantId } = deps;

  app.get('/api/growth/menu-health-reports', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    try {
      const reports = await tenantContext.run(getPhaseTenantId(req), () =>
        listMenuHealthReports(pool, {
          storeCode: req.query.store_code,
          reportMonth: req.query.report_month,
        })
      );
      return res.json({ ok: true, reports });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/growth/menu-health-reports/:month', async (req, res) => {
    if (!requirePhaseAuth(req, res)) return;
    const month = safeMonthOnly(req.params.month || '');
    const storeCode = cleanText(req.query.store_code || '', 128);
    if (!month) return res.status(400).json({ ok: false, error: 'invalid_month' });
    try {
      const reports = await tenantContext.run(getPhaseTenantId(req), () =>
        getMenuHealthReportsByMonth(pool, month, storeCode)
      );
      return res.json({ ok: true, reports });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/growth/menu-health-reports/generate', async (req, res) => {
    const auth = authPhaseApi(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ ok: false, error: auth.error });
    const storeCode = cleanText(req.body?.store_code || req.query?.store_code || '', 128);
    const reportMonth = safeMonthOnly(req.body?.report_month || req.query?.report_month || todayShanghaiYmd().slice(0, 7));
    const tenantId = getPhaseTenantId(req);
    try {
      const report = await tenantContext.run(tenantId, () =>
        generateMenuHealthReport(pool, storeCode, reportMonth, tenantId)
      );
      return res.json({ ok: true, report });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
