/**
 * Payroll month-run / compute / ledger routes — P5.4 peel from registerHrmsPayrollClosedLoopRoutes.
 */
import {
  buildPayrollForMonth,
  upsertPayrollLedgerEntry,
  listPayrollLedgerForMonth,
  setMonthRunStatus,
  getOrCreateMonthRun,
} from '../../services/hrms-payroll-engine.js';
import { childLogger } from '../../utils/logger.js';
import { requirePayrollPerm, tenantOf } from './route-helpers.js';

const log = childLogger({ domain: 'hrms-payroll', handler: 'routes-payroll' });

export function registerPayrollMonthRoutes(app, authRequired, db, deps) {
  const {
    getSharedState,
    calcEmployeeMonthlyLeaveBalance,
    findUserSalary,
    safeMonthOnly,
    parseMonth,
    dbListEmployeesForReports,
    isLegacyTestUsername,
  } = deps;

  app.get('/api/hrms/payroll/month-run', authRequired, async (req, res) => {
    try {
      const store = String(req.query?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.view', store, getSharedState))) return;
      const month = parseMonth?.(req.query?.month) || safeMonthOnly?.(req.query?.month);
      if (!month) return res.status(400).json({ error: 'missing_month' });
      const row = await getOrCreateMonthRun({
        tenantId: tenantOf(req),
        store: String(req.query?.store || '').trim(),
        month,
        db,
      });
      return res.json({ row });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/hrms/payroll/month-run/status', authRequired, async (req, res) => {
    try {
      const store = String(req.body?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.month_run', store, getSharedState))) return;
      const month = parseMonth?.(req.body?.month) || safeMonthOnly?.(req.body?.month);
      if (!month) return res.status(400).json({ error: 'missing_month' });
      const result = await setMonthRunStatus({
        tenantId: tenantOf(req),
        store: String(req.body?.store || '').trim(),
        month,
        status: req.body?.status,
        by: req.user?.username,
        snapshot: req.body?.snapshot,
        db,
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      log.error({ msg: 'month_run_status_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/hrms/payroll/compute', authRequired, async (req, res) => {
    try {
      const store = String(req.query?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.view', store, getSharedState))) return;
      const month = parseMonth?.(req.query?.month) || safeMonthOnly?.(req.query?.month);
      if (!month) return res.status(400).json({ error: 'missing_month' });
      const tid = tenantOf(req);
      const state0 = (await getSharedState?.(tid)) || {};
      const emps = Array.isArray(state0.employees) ? state0.employees : [];
      let people = emps.filter((e) => {
        const u = String(e?.username || '').trim();
        if (!u || isLegacyTestUsername?.(u)) return false;
        if (store && String(e?.store || '').trim() !== store) return false;
        const st = String(e?.status || '').trim().toLowerCase();
        if (st === '离职' || st === 'inactive') return false;
        return true;
      });
      if (!people.length && dbListEmployeesForReports) {
        people = await dbListEmployeesForReports({ store, includeInactive: false, tenantId: tid });
      }

      const leaveBalanceByUser = new Map();
      for (const p of people) {
        const bal = calcEmployeeMonthlyLeaveBalance?.(state0, p, month);
        if (bal) leaveBalanceByUser.set(String(p.username || '').trim().toLowerCase(), Number(bal.remaining || 0));
      }

      const result = await buildPayrollForMonth({
        tenantId: tid,
        month,
        store,
        people,
        leaveBalanceByUser,
        getSharedState,
        findUserSalary,
        state: state0,
        reconcile: String(req.query?.reconcile || '1') !== '0',
        db,
      });
      return res.json(result);
    } catch (e) {
      log.error({ msg: 'payroll_compute_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/hrms/payroll/ledger', authRequired, async (req, res) => {
    try {
      const store = String(req.query?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.ledger', store, getSharedState))) return;
      const month = parseMonth?.(req.query?.month) || safeMonthOnly?.(req.query?.month);
      if (!month) return res.status(400).json({ error: 'missing_month' });
      const rows = await listPayrollLedgerForMonth({
        tenantId: tenantOf(req),
        month,
        store: String(req.query?.store || '').trim() || undefined,
        username: String(req.query?.username || '').trim() || undefined,
        db,
      });
      return res.json({ month, rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/hrms/payroll/ledger/manual', authRequired, async (req, res) => {
    try {
      const store = String(req.body?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.adjust', store, getSharedState))) return;
      const month = parseMonth?.(req.body?.month) || safeMonthOnly?.(req.body?.month);
      const username = String(req.body?.username || '').trim();
      const amount = Number(req.body?.amount);
      if (!month || !username || !Number.isFinite(amount)) {
        return res.status(400).json({ error: 'missing_fields' });
      }
      const result = await upsertPayrollLedgerEntry({
        tenantId: tenantOf(req),
        username,
        store: String(req.body?.store || '').trim(),
        bizMonth: month,
        entryType: 'manual_subsidy',
        amount,
        title: String(req.body?.title || '人工补贴').trim(),
        reason: String(req.body?.reason || '').trim(),
        createdBy: req.user?.username,
        db,
      });
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });
}
