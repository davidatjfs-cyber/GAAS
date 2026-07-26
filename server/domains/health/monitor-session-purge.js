/**
 * Extracted from createListenMonitors — P5.4.
 */
import { childLogger } from '../../utils/logger.js';
const log = childLogger({ domain: 'health', handler: 'startup-monitors' });

export function scheduleSessionStatePurge(deps) {
  const {
    pool, runForActiveTenants, runWithBootstrapTenantContext, getSharedState,
    mergeSharedStateFields, purgeExpiredCache, upsertLeaveDomainFromState,
    upsertPayrollDomainFromState, getExpectedMonthlyPerformancePeriodShanghai,
    countEligibleMonthlyPerformanceUsers, leaveAttendanceHelpers, safeErrMessage,
    allowSchemaChanges, setIntervalFn = setInterval, setTimeoutFn = setTimeout,
    beatHeartbeat, sendSystemAlert,
    isPosSalesCheckWindow, isLeaveCumulativeSnapshotWindow,
    findMissingPosStores, expectedStoresFromState,
    dailyReportItemFromPgRow,
    DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN, filterStaleHeartbeats,
    formatStaleHeartbeatDeadLabel, staleHeartbeatDedupeKey,
  } = deps;

// P0B: Purge expired session states every hour
// 原用runWithBootstrapTenantContext只清default租户，agent_long_memory开了RLS，改为遍历活跃租户各自清理
setIntervalFn(async () => {
  try {
    await runForActiveTenants(async (tenantId) => {
      try {
        const r = await pool.query(
          `DELETE FROM agent_long_memory
           WHERE memory_key = 'session_state'
             AND updated_at < NOW() - INTERVAL '2 hours'`
        );
        if (r.rowCount > 0) log.info({ msg: 'monitor', detail: [`[intelligence] Purged ${r.rowCount} expired session states, tenant=${tenantId}`].map((x) => (x == null ? '' : String(x))).join(' ') });
      } catch (e) {
        log.error({ msg: 'monitor', detail: ['[intelligence] Session state purge error:', tenantId, e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
      }
    }, { continueOnError: true });
  } catch (e) {
    log.error({ msg: 'monitor', detail: ['[intelligence] Session state purge runForActiveTenants error:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
  }
}, 60 * 60 * 1000);
}
