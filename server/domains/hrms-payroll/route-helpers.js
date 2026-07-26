/**
 * Payroll route permission helpers — P5.4 peel from registerHrmsPayrollClosedLoopRoutes.
 */
import {
  requireHrmsPermission,
  getTenantEnforcementMode,
  legacyCanManagePayrollRules,
  legacyCanAccessAnalyticsReports,
} from '../../services/hrms-permission-engine.js';

export function tenantOf(req) {
  return String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
}

export async function requirePayrollPerm(req, res, permission, store, getSharedState) {
  const mode = await getTenantEnforcementMode(tenantOf(req));
  if (mode === 'legacy') {
    if (permission === 'reports.payroll.rules' || permission === 'reports.payroll.reconcile') {
      if (!legacyCanManagePayrollRules(req.user?.role)) {
        res.status(403).json({ error: 'forbidden' });
        return false;
      }
      return true;
    }
    if (permission === 'reports.payroll.abnormal_confirm') {
      const r = String(req.user?.role || '').trim().toLowerCase();
      if (!(r === 'store_manager' || legacyCanManagePayrollRules(req.user?.role))) {
        res.status(403).json({ error: 'forbidden' });
        return false;
      }
      return true;
    }
    if (permission === 'reports.payroll.month_run') {
      if (!legacyCanManagePayrollRules(req.user?.role)) {
        res.status(403).json({ error: 'forbidden' });
        return false;
      }
      return true;
    }
    if (!legacyCanAccessAnalyticsReports(req.user?.role)) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    return true;
  }
  return requireHrmsPermission(req, res, permission, { store, getSharedState });
}
