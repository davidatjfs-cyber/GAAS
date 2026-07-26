/**
 * Attendance payroll rules routes — P5.4 peel from registerHrmsPayrollClosedLoopRoutes.
 */
import {
  seedDefaultBrandPayrollRules,
  listAttendancePayrollRules,
  upsertAttendancePayrollRules,
  resolveAttendancePayrollRules,
  DEFAULT_ATTENDANCE_PAYROLL_RULES,
} from '../../services/hrms-payroll-rules.js';
import { childLogger } from '../../utils/logger.js';
import { requirePayrollPerm, tenantOf } from './route-helpers.js';

const log = childLogger({ domain: 'hrms-payroll', handler: 'routes-rules' });

export function registerPayrollRulesRoutes(app, authRequired, db, getSharedState) {
  app.get('/api/hrms/attendance-payroll-rules', authRequired, async (req, res) => {
    try {
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.rules', undefined, getSharedState))) return;
      await seedDefaultBrandPayrollRules(tenantOf(req), db);
      const rows = await listAttendancePayrollRules(tenantOf(req), db);
      return res.json({ defaults: DEFAULT_ATTENDANCE_PAYROLL_RULES, rows });
    } catch (e) {
      log.error({ msg: 'attendance_payroll_rules_list_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/hrms/attendance-payroll-rules/resolve', authRequired, async (req, res) => {
    try {
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.rules', undefined, getSharedState))) return;
      const store = String(req.query?.store || '').trim();
      const brandKey = String(req.query?.brand || req.query?.brandKey || '').trim();
      const resolved = await resolveAttendancePayrollRules({
        tenantId: tenantOf(req),
        store,
        brandKey,
        db,
      });
      return res.json(resolved);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.put('/api/hrms/attendance-payroll-rules', authRequired, async (req, res) => {
    try {
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.rules', undefined, getSharedState))) return;
      const scopeType = String(req.body?.scopeType || req.body?.scope_type || 'brand').trim();
      const scopeKey = String(req.body?.scopeKey || req.body?.scope_key || '').trim();
      const rules = req.body?.rules && typeof req.body.rules === 'object' ? req.body.rules : null;
      if (!rules) return res.status(400).json({ error: 'missing_rules' });
      const row = await upsertAttendancePayrollRules({
        tenantId: tenantOf(req),
        scopeType,
        scopeKey,
        rules,
        updatedBy: req.user?.username,
        db,
      });
      return res.json({ ok: true, row });
    } catch (e) {
      log.error({ msg: 'attendance_payroll_rules_upsert_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error' });
    }
  });
}
