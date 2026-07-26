/**
 * 考勤薪资闭环 API：规则配置、日结果、异常确认、月结、账本
 */
import {
  ensurePayrollRulesTables,
  seedDefaultBrandPayrollRules,
  cloneDefaultRules,
} from './services/hrms-payroll-rules.js';
import {
  buildPayrollForMonth,
  upsertPayrollLedgerEntry,
  applyPromotionSalaryNextMonth,
  insertSalaryTimeline,
} from './services/hrms-payroll-engine.js';
import { registerPayrollRulesRoutes } from './domains/hrms-payroll/routes-rules.js';
import { registerPayrollAttendanceRoutes } from './domains/hrms-payroll/routes-attendance.js';
import { registerPayrollMonthRoutes } from './domains/hrms-payroll/routes-payroll.js';

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
    isLegacyTestUsername,
  } = deps;

  const db = typeof pool === 'function' ? pool() : pool;

  registerPayrollRulesRoutes(app, authRequired, db, getSharedState);
  registerPayrollAttendanceRoutes(app, authRequired, db, { getSharedState, appendNotifications, makeNotif });
  registerPayrollMonthRoutes(app, authRequired, db, {
    getSharedState,
    calcEmployeeMonthlyLeaveBalance,
    findUserSalary,
    safeMonthOnly,
    parseMonth,
    dbListEmployeesForReports,
    isLegacyTestUsername,
  });

  app.locals = app.locals || {};
  app.locals.hrmsPayrollClosedLoop = {
    upsertPayrollLedgerEntry,
    applyPromotionSalaryNextMonth,
    insertSalaryTimeline,
    seedDefaultBrandPayrollRules,
    ensurePayrollRulesTables,
    cloneDefaultRules,
  };
}

export {
  ensurePayrollRulesTables,
  seedDefaultBrandPayrollRules,
  upsertPayrollLedgerEntry,
  applyPromotionSalaryNextMonth,
  insertSalaryTimeline,
  buildPayrollForMonth,
};
