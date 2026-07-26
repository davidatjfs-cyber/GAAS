/**
 * Listen-time multi-tenant state↔DB reconcile (Wave M1 peel from index.js app.listen).
 * Each step is non-fatal; continueOnError across tenants.
 */
import { childLogger } from '../../utils/logger.js';
import { bindDailyReportsRuntimeDeps } from '../daily-reports/helpers.js';
import {
  mergeDailyReportsForStartup,
  mergePointRecordsForStartup,
} from './startup-tenant-reconcile-merge.js';
import {
  reconcileDailyReportsOnStartup,
  reconcilePointRecordsOnStartup,
  syncAttendanceTablesOnStartup,
  reconcilePayrollDomainOnStartup,
  reconcileLeaveDomainOnStartup,
  syncEmployeesOnStartup,
  reconcileLeaveRecordsOnStartup,
  reconcileRewardPunishmentOnStartup,
  checkApprovalRequestsOnStartup,
  reconcileNotificationsOnStartup,
  backfillLeaveRecordsOnStartup,
  backfillRewardPunishmentOnStartup,
  backfillDailyReportDetailsOnStartup,
  backfillDailyAttendanceRegisterOnStartup,
  finalizeSocialMediaPointRulesOnStartup,
} from './startup-tenant-reconcile-steps.js';

export { mergeDailyReportsForStartup, mergePointRecordsForStartup };

const log = childLogger({ domain: 'shared', handler: 'startup-tenant-reconcile' });

/**
 * @param {object} deps
 * @returns {() => Promise<{results: any[], errors: any[]}>}
 */
export function createStartupTenantReconcileRunner(deps) {
  const ctx = { ...deps };

  return async function runStartupTenantReconcile() {
    bindDailyReportsRuntimeDeps({
      pool: ctx.pool,
      hrmsNowISO: ctx.hrmsNowISO,
      getSharedState: ctx.getSharedState,
      safeDateOnly: (v) => String(v || '').trim().slice(0, 10),
    });

    const startupTenantReconcile = await ctx.runForActiveTenants(
      async (tenantId) => {
        await reconcileDailyReportsOnStartup(ctx, tenantId);
        await reconcilePointRecordsOnStartup(ctx, tenantId);
        await syncAttendanceTablesOnStartup(ctx, tenantId);
        await reconcilePayrollDomainOnStartup(ctx, tenantId);
        await reconcileLeaveDomainOnStartup(ctx, tenantId);
        await syncEmployeesOnStartup(ctx, tenantId);
        await reconcileLeaveRecordsOnStartup(ctx, tenantId);
        await reconcileRewardPunishmentOnStartup(ctx, tenantId);
        await checkApprovalRequestsOnStartup(ctx, tenantId);
        await reconcileNotificationsOnStartup(ctx, tenantId);
        await backfillLeaveRecordsOnStartup(ctx, tenantId);
        await backfillRewardPunishmentOnStartup(ctx, tenantId);
        await backfillDailyReportDetailsOnStartup(ctx, tenantId);
        await backfillDailyAttendanceRegisterOnStartup(ctx, tenantId);
        await finalizeSocialMediaPointRulesOnStartup(ctx, tenantId);
      },
      {
        continueOnError: true,
        onError: ({ tenantId, error }) => {
          log.error({
            msg: 'startup',
            detail: [`[startup][${tenantId}] 租户数据重建失败（非致命）:`, ctx.safeErrMessage(error)]
              .map((x) => (x == null ? '' : String(x)))
              .join(' '),
          });
        },
      }
    );
    log.info({
      msg: 'startup',
      detail: [
        `[startup] 多租户数据重建完成：成功 ${startupTenantReconcile.results.length}，失败 ${startupTenantReconcile.errors.length}`,
      ]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });

    return startupTenantReconcile;
  };
}
