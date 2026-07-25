/**
 * 考勤薪资闭环 API：规则配置、日结果、异常确认、月结、账本
 */
import {
  ensurePayrollRulesTables,
  seedDefaultBrandPayrollRules,
  listAttendancePayrollRules,
  upsertAttendancePayrollRules,
  resolveAttendancePayrollRules,
  cloneDefaultRules,
  DEFAULT_ATTENDANCE_PAYROLL_RULES
} from './services/hrms-payroll-rules.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'hrms-payroll', handler: 'routes' });
import {
  reconcileAttendanceDays,
  confirmAttendanceDayAbnormal,
  listAbnormalAttendanceDays,
  notifyStoreManagersAttendanceAbnormals
} from './services/hrms-attendance-day.js';
import {
  buildPayrollForMonth,
  upsertPayrollLedgerEntry,
  listPayrollLedgerForMonth,
  setMonthRunStatus,
  getOrCreateMonthRun,
  insertSalaryTimeline,
  applyPromotionSalaryNextMonth
} from './services/hrms-payroll-engine.js';
import {
  requireHrmsPermission,
  getTenantEnforcementMode,
  legacyCanManagePayrollRules,
  legacyCanAccessAnalyticsReports,
} from './services/hrms-permission-engine.js';

export function registerHrmsPayrollClosedLoopRoutes(app, deps = {}) {
  const {
    pool,
    authRequired,
    getSharedState,
    calcEmployeeMonthlyLeaveBalance,
    findUserSalary,


    appendNotifications,
    makeNotif,

    safeMonthOnly,
    parseMonth,
    dbListEmployeesForReports,

    isLegacyTestUsername
  } = deps;

  const db = typeof pool === 'function' ? pool() : pool;

  function tenantOf(req) {
    return String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
  }

  function canManageRules(role) {
    const r = String(role || '').trim().toLowerCase();
    return r === 'admin' || r === 'hr_manager' || r === 'hq_manager';
  }

  async function requirePayrollPerm(req, res, permission, store) {
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

  // ── 规则 ──
  app.get('/api/hrms/attendance-payroll-rules', authRequired, async (req, res) => {
    try {
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.rules'))) return;
      await seedDefaultBrandPayrollRules(tenantOf(req), db);
      const rows = await listAttendancePayrollRules(tenantOf(req), db);
      return res.json({
        defaults: DEFAULT_ATTENDANCE_PAYROLL_RULES,
        rows
      });
    } catch (e) {
      log.error({ msg: 'attendance_payroll_rules_list_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/hrms/attendance-payroll-rules/resolve', authRequired, async (req, res) => {
    try {
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.rules'))) return;
      const store = String(req.query?.store || '').trim();
      const brandKey = String(req.query?.brand || req.query?.brandKey || '').trim();
      const resolved = await resolveAttendancePayrollRules({
        tenantId: tenantOf(req),
        store,
        brandKey,
        db
      });
      return res.json(resolved);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.put('/api/hrms/attendance-payroll-rules', authRequired, async (req, res) => {
    try {
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.rules'))) return;
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
        db
      });
      return res.json({ ok: true, row });
    } catch (e) {
      log.error({ msg: 'attendance_payroll_rules_upsert_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // ── 日结果 / 异常 ──
  app.post('/api/hrms/attendance-day/reconcile', authRequired, async (req, res) => {
    try {
      const store = String(req.body?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.reconcile', store))) return;
      const startDate = String(req.body?.start || req.body?.startDate || '').trim();
      const endDate = String(req.body?.end || req.body?.endDate || startDate).trim();
      if (!store || !startDate) return res.status(400).json({ error: 'missing_store_or_start' });
      const result = await reconcileAttendanceDays({
        tenantId: tenantOf(req),
        store,
        startDate,
        endDate,
        db,
        getSharedState
      });
      if (result.abnormals?.length && appendNotifications && makeNotif) {
        await notifyStoreManagersAttendanceAbnormals({
          abnormals: result.abnormals,
          appendNotifications,
          makeNotif,
          getSharedState,
          tenantId: tenantOf(req)
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
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.view', store))) return;
      const rows = await listAbnormalAttendanceDays({
        tenantId: tenantOf(req),
        store: String(req.query?.store || '').trim() || undefined,
        startDate: String(req.query?.start || '').trim() || undefined,
        endDate: String(req.query?.end || '').trim() || undefined,
        db
      });
      return res.json({ rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/hrms/attendance-day/confirm', authRequired, async (req, res) => {
    try {
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.abnormal_confirm'))) return;
      const result = await confirmAttendanceDayAbnormal({
        tenantId: tenantOf(req),
        username: req.body?.username,
        workDate: req.body?.workDate || req.body?.date,
        choice: req.body?.choice,
        confirmedBy: req.user?.username,
        note: req.body?.note,
        db
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // ── 月结 ──
  app.get('/api/hrms/payroll/month-run', authRequired, async (req, res) => {
    try {
      const store = String(req.query?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.view', store))) return;
      const month = parseMonth?.(req.query?.month) || safeMonthOnly?.(req.query?.month);
      if (!month) return res.status(400).json({ error: 'missing_month' });
      const row = await getOrCreateMonthRun({
        tenantId: tenantOf(req),
        store: String(req.query?.store || '').trim(),
        month,
        db
      });
      return res.json({ row });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/hrms/payroll/month-run/status', authRequired, async (req, res) => {
    try {
      const store = String(req.body?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.month_run', store))) return;
      const month = parseMonth?.(req.body?.month) || safeMonthOnly?.(req.body?.month);
      if (!month) return res.status(400).json({ error: 'missing_month' });
      const result = await setMonthRunStatus({
        tenantId: tenantOf(req),
        store: String(req.body?.store || '').trim(),
        month,
        status: req.body?.status,
        by: req.user?.username,
        snapshot: req.body?.snapshot,
        db
      });
      if (!result.ok) return res.status(400).json(result);
      return res.json(result);
    } catch (e) {
      log.error({ msg: 'month_run_status_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // ── 薪资试算（新引擎）──
  app.get('/api/hrms/payroll/compute', authRequired, async (req, res) => {
    try {
      const store = String(req.query?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.view', store))) return;
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
        db
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
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.ledger', store))) return;
      const month = parseMonth?.(req.query?.month) || safeMonthOnly?.(req.query?.month);
      if (!month) return res.status(400).json({ error: 'missing_month' });
      const rows = await listPayrollLedgerForMonth({
        tenantId: tenantOf(req),
        month,
        store: String(req.query?.store || '').trim() || undefined,
        username: String(req.query?.username || '').trim() || undefined,
        db
      });
      return res.json({ month, rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/hrms/payroll/ledger/manual', authRequired, async (req, res) => {
    try {
      const store = String(req.body?.store || '').trim();
      if (!(await requirePayrollPerm(req, res, 'reports.payroll.adjust', store))) return;
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
        db
      });
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // 导出供审批后置钩子使用
  app.locals = app.locals || {};
  app.locals.hrmsPayrollClosedLoop = {
    upsertPayrollLedgerEntry,
    applyPromotionSalaryNextMonth,
    insertSalaryTimeline,
    seedDefaultBrandPayrollRules,
    ensurePayrollRulesTables,
    cloneDefaultRules
  };
}

export {
  ensurePayrollRulesTables,
  seedDefaultBrandPayrollRules,
  upsertPayrollLedgerEntry,
  applyPromotionSalaryNextMonth,
  insertSalaryTimeline,
  buildPayrollForMonth
};
