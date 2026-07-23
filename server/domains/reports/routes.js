/**
 * Core business reports routes composer.
 * registerReportsRoutes(app, deps) — behavior-preserving move.
 *
 * NOTE: inventory-forecast/sales-raw under /api/reports/* stays in index.js.
 */
import { bindReportsRuntimeDeps } from './helpers.js';
import { registerReportsBiRoutes } from './routes-bi.js';
import { registerReportsBusinessRoutes } from './routes-business.js';
import { registerReportsTurnoverRoutes } from './routes-turnover.js';
import { registerReportsLeaveOwedRoutes } from './routes-leave-owed.js';
import { registerReportsAttendanceRoutes } from './routes-attendance.js';
import { registerReportsPayrollRoutes } from './routes-payroll.js';
import { registerReportsHrHistoryRoutes } from './routes-hr-history.js';

export function registerReportsRoutes(app, deps) {
  bindReportsRuntimeDeps({
    pool: deps.pool,
    safeMonthOnly: deps.safeMonthOnly,
    resolveAgentCanonicalStore: deps.resolveAgentCanonicalStore,
    getSharedState: deps.getSharedState,
  });

  registerReportsBiRoutes(app, deps);
  registerReportsBusinessRoutes(app, deps);
  registerReportsTurnoverRoutes(app, deps);
  registerReportsLeaveOwedRoutes(app, deps);
  registerReportsAttendanceRoutes(app, deps);
  registerReportsPayrollRoutes(app, deps);
  registerReportsHrHistoryRoutes(app, deps);
}
