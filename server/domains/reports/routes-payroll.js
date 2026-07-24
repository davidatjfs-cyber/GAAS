/**
 * Payroll GET + audit + adjustment — /api/reports/payroll*
 * Handlers stay thin; business logic lives in service-payroll.js.
 */
import { pool, requireReportPerm } from './helpers.js';
import {
  getPayrollReportPayload,
  auditPayrollMonth,
  adjustPayrollRow,
} from './service-payroll.js';

function sendServiceResult(res, result, okBody) {
  if (!result.ok) {
    const body = { error: result.error };
    if (result.message) body.message = result.message;
    return res.status(result.status).json(body);
  }
  return res.json(okBody(result));
}

export function registerReportsPayrollRoutes(app, deps) {
  const { authRequired, parseMonth } = deps;
  const ctx = { pool, ...deps };

  app.get('/api/reports/payroll', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQ = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.payroll.view', storeQ))) return;
    const month = parseMonth(req.query?.month);
    if (!month) return res.status(400).json({ error: 'missing_month' });

    const result = await getPayrollReportPayload(ctx, {
      month,
      storeQ,
      role,
      username,
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
      allowedStores: Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [],
      currentStore: String(req.user?.current_store || '').trim(),
    });
    return sendServiceResult(res, result, (r) => r.payload);
  });

  app.post('/api/reports/payroll/audit', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const store = String(req.body?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.payroll.audit', store))) return;
    const month = parseMonth(req.body?.month);
    if (!month) return res.status(400).json({ error: 'missing_month' });

    const result = await auditPayrollMonth(ctx, {
      month,
      store,
      username,
      audited: !!req.body?.audited,
    });
    return sendServiceResult(res, result, (r) => ({ ok: true, audit: r.audit }));
  });

  app.post('/api/reports/payroll/adjustment', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const store = String(req.body?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.payroll.adjust', store))) return;
    const month = parseMonth(req.body?.month);
    if (!month) return res.status(400).json({ error: 'missing_month' });

    const result = await adjustPayrollRow(ctx, {
      month,
      store,
      targetUsername: String(req.body?.username || '').trim(),
      subsidy: req.body?.subsidy,
      baseAmount: req.body?.baseAmount,
      reason: req.body?.reason,
      username,
      tenantId: req.tenantId || req.user?.tenant_id || 'default',
    });
    return sendServiceResult(res, result, (r) => ({ ok: true, item: r.item }));
  });
}
