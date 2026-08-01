/**
 * Extracted from createListenMonitors — P5.4.
 */
import { childLogger } from '../../utils/logger.js';
const log = childLogger({ domain: 'health', handler: 'startup-monitors' });

export function scheduleLeaveCumulativeSnapshot(deps) {
  const {
    pool: _pool, runForActiveTenants, runWithBootstrapTenantContext: _runWithBootstrapTenantContext, getSharedState: _getSharedState,
    mergeSharedStateFields: _mergeSharedStateFields, purgeExpiredCache: _purgeExpiredCache, upsertLeaveDomainFromState: _upsertLeaveDomainFromState,
    upsertPayrollDomainFromState: _upsertPayrollDomainFromState, getExpectedMonthlyPerformancePeriodShanghai: _getExpectedMonthlyPerformancePeriodShanghai,
    countEligibleMonthlyPerformanceUsers: _countEligibleMonthlyPerformanceUsers, leaveAttendanceHelpers, safeErrMessage,
    allowSchemaChanges: _allowSchemaChanges, setIntervalFn = setInterval, setTimeoutFn: _setTimeoutFn = setTimeout,
    beatHeartbeat, sendSystemAlert,
    isPosSalesCheckWindow: _isPosSalesCheckWindow, isLeaveCumulativeSnapshotWindow,
    findMissingPosStores: _findMissingPosStores, expectedStoresFromState: _expectedStoresFromState,
    dailyReportItemFromPgRow: _dailyReportItemFromPgRow,
    DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN: _DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN, filterStaleHeartbeats: _filterStaleHeartbeats,
    formatStaleHeartbeatDeadLabel: _formatStaleHeartbeatDeadLabel, staleHeartbeatDedupeKey: _staleHeartbeatDedupeKey,
  } = deps;

// ── 上月末「累计假期」池快照：上海时间每月 1 日 06:00–06:14 写入，供当月展示与公式解耦 ──
// 原用 runWithBootstrapTenantContext 只处理 default 租户；改为遍历全部活跃租户，
// 去重标记也从单一字符串改为按租户区分的 Map，避免A租户跑完误挡住B租户。
const _leaveCumulativeSnapshotDoneCurYm = new Map();
setIntervalFn(async () => {
  try {
    await runForActiveTenants(async (tenantId) => {
      try {
        const partsFmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        const p = partsFmt.formatToParts(new Date());
        const gv = (t) => p.find(x => x.type === t)?.value || '';
        if (!isLeaveCumulativeSnapshotWindow(p)) return;
        const y = gv('year');
        const mo = gv('month');
        const curYm = `${y}-${mo}`;
        if (_leaveCumulativeSnapshotDoneCurYm.get(tenantId) === curYm) return;
        const closedMonth = leaveAttendanceHelpers.shiftMonth(curYm, -1);
        if (!closedMonth) return;
        const r = await leaveAttendanceHelpers.runLeaveCumulativeCloseSnapshotForClosedMonth(closedMonth);
        if (r?.ok) {
          _leaveCumulativeSnapshotDoneCurYm.set(tenantId, curYm);
          log.info({ msg: 'monitor', detail: ['[leave-cumulative-snapshot] locked tenant=', tenantId, 'closedMonth=', r.closedMonth, 'employees=', r.employees].map((x) => (x == null ? '' : String(x))).join(' ') });
          // 2026-08-01 补：这个月度任务之前完全没有心跳，导致今天整窗口(06:00-06:14)连续失败
          // 14次都没人知道，直到用户自己发现月度报表缺数据。现在跟其它 monitor 一样打心跳，
          // /api/health 能据此发现"这个月没打过卡"。
          await beatHeartbeat(deps, 'leave_cumulative_snapshot');
        } else {
          await sendSystemAlert([
            '🔴 [HRMS] 上月累计假期自动快照失败',
            `租户：${tenantId}`,
            `闭合月：${closedMonth}`,
            `当前上海月：${curYm}`,
            `原因：${String(r?.error || 'unknown')}`,
            '请检查服务日志 [leave-cumulative-snapshot] 与 state 持久化；窗口内将每分钟重试。'
          ].join('\n'));
        }
      } catch (e) {
        log.error({ msg: 'monitor', detail: ['[leave-cumulative-snapshot] tick:', tenantId, e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
        try {
          await sendSystemAlert([
            '🔴 [HRMS] 上月累计假期快照任务异常',
            `租户：${tenantId}`,
            `错误：${safeErrMessage(e)}`,
            '请检查 hrms-service 日志与数据库/共享状态写入。'
          ].join('\n'));
        } catch (_) { /* ignore */ }
      }
    }, { continueOnError: true });
  } catch (e) {
    log.error({ msg: 'monitor', detail: ['[leave-cumulative-snapshot] runForActiveTenants error:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
  }
}, 60 * 1000);
}
