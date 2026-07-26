/**
 * Attendance day reconcile routes — P5.4 peel from registerHrmsPayrollClosedLoopRoutes.
 */
import {
  reconcileAttendanceDays,
  confirmAttendanceDayAbnormal,
  listAbnormalAttendanceDays,
  notifyStoreManagersAttendanceAbnormals,
} from '../../services/hrms-attendance-day.js';
import { childLogger } from '../../utils/logger.js';
import { requirePayrollPerm, tenantOf } from './route-helpers.js';

const log = childLogger({ domain: 'hrms-payroll', handler: 'routes-attendance' });

export function registerPayrollAttendanceRoutes(app, authRequired, db, deps) {
  const { getSharedState, appendNotifications, makeNotif } = deps;

  app.post('/api/hrms/attendance-day/reconcile', authRequired, async (req, res) => {
    try {
      const store = String(req.body?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.reconcile', store, getSharedState))) return;
      const startDate = String(req.body?.start || req.body?.startDate || '').trim();
      const endDate = String(req.body?.end || req.body?.endDate || startDate).trim();
      if (!store || !startDate) return res.status(400).json({ error: 'missing_store_or_start' });
      const result = await reconcileAttendanceDays({
        tenantId: tenantOf(req),
        store,
        startDate,
        endDate,
        db,
        getSharedState,
      });
      if (result.abnormals?.length && appendNotifications && makeNotif) {
        await notifyStoreManagersAttendanceAbnormals({
          abnormals: result.abnormals,
          appendNotifications,
          makeNotif,
          getSharedState,
          tenantId: tenantOf(req),
        });
      }
      return res.json(result);
    } catch (e) {
      log.error({ msg: 'attendance_day_reconcile_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/hrms/attendance-day/abnormals', authRequired, async (req, res) => {
    try {
      const store = String(req.query?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.view', store, getSharedState))) return;
      const rows = await listAbnormalAttendanceDays({
        tenantId: tenantOf(req),
        store: String(req.query?.store || '').trim() || undefined,
        startDate: String(req.query?.start || '').trim() || undefined,
        endDate: String(req.query?.end || '').trim() || undefined,
        db,
      });
      return res.json({ rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/hrms/attendance-day/confirm', authRequired, async (req, res) => {
    try {
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.abnormal_confirm', undefined, getSharedState))) return;
      const result = await confirmAttendanceDayAbnormal({
        tenantId: tenantOf(req),
        username: req.body?.username,
        workDate: req.body?.workDate || req.body?.date,
        choice: req.body?.choice,
        confirmedBy: req.user?.username,
        note: req.body?.note,
        db,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });
}
