/**
 * Listen-time monitors: session purge, heartbeat, cache purge, critical reconcile,
 * POS sales check, leave-cumulative snapshot (Wave M2 peel from index.js app.listen).
 */
import { childLogger } from '../../utils/logger.js';
import {
  DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN,
  filterStaleHeartbeats,
  formatStaleHeartbeatDeadLabel,
  staleHeartbeatDedupeKey,
} from './scheduler-heartbeat.js';
import { dailyReportItemFromPgRow, bindDailyReportsRuntimeDeps } from '../daily-reports/helpers.js';
import { beatHeartbeat as beatHeartbeatImpl, sendSystemAlert as sendSystemAlertImpl } from './monitor-beat.js';
import { scheduleSessionStatePurge } from './monitor-session-purge.js';
import { scheduleCacheAndHeartbeat } from './monitor-cache-heartbeat.js';
import { scheduleCriticalDataReconcile } from './monitor-critical-reconcile.js';
import { schedulePosSalesCheck } from './monitor-pos-sales.js';
import { scheduleLeaveCumulativeSnapshot } from './monitor-leave-snapshot.js';

const _log = childLogger({ domain: 'health', handler: 'startup-monitors' });

/** Pure: POS sales check fires 23:30–23:34 local clock. */
export function isPosSalesCheckWindow(now = new Date()) {
  const h = now.getHours();
  const m = now.getMinutes();
  return h === 23 && m >= 30 && m <= 34;
}

/** Pure: Shanghai calendar parts for leave snapshot (day=01, hour=6, minute<15). */
export function isLeaveCumulativeSnapshotWindow(parts) {
  const gv = (t) => parts.find((x) => x.type === t)?.value || '';
  const d = gv('day');
  const h = Number(gv('hour'));
  const mi = Number(gv('minute'));
  return d === '01' && h === 6 && mi < 15;
}

/** Pure: after monthly performance close window (day>10 or day=10 hour>=2 Shanghai). */
export function isPastMonthlyPerformanceCloseWindow(shDay, shHour) {
  return shDay > 10 || (shDay === 10 && shHour >= 2);
}

/** Pure: expected store names missing from POS present list (4-char fuzzy). */
export function findMissingPosStores(expectedStores, presentStores) {
  return (expectedStores || []).filter(
    (es) => !presentStores.some((ps) => ps.includes(es.slice(0, 4)) || es.includes(ps.slice(0, 4)))
  );
}

/** Pure: collect expected stores from state employees/users (active store_managers). */
export function expectedStoresFromState(state) {
  const staffList = [].concat(
    Array.isArray(state?.employees) ? state.employees : [],
    Array.isArray(state?.users) ? state.users : []
  );
  return [
    ...new Set(
      staffList
        .filter(
          (x) =>
            String(x?.role || '').trim() === 'store_manager' &&
            String(x?.status || '').trim() !== '离职' &&
            String(x?.status || '').trim() !== 'inactive'
        )
        .map((x) => String(x?.store || '').trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * @param {object} deps
 * @returns {{ beatHeartbeat: Function, startListenMonitors: Function }}
 */
export function createListenMonitors(deps) {
  const {
    pool,
    getSharedState,
    hrmsNowISO,
    setIntervalFn = setInterval,
    setTimeoutFn = setTimeout,
  } = deps;

  const bound = {
    ...deps,
    setIntervalFn,
    setTimeoutFn,
    beatHeartbeat: (taskName) => beatHeartbeatImpl(bound, taskName),
    sendSystemAlert: (msg) => sendSystemAlertImpl(bound, msg),
    isPosSalesCheckWindow,
    isLeaveCumulativeSnapshotWindow,
    isPastMonthlyPerformanceCloseWindow,
    findMissingPosStores,
    expectedStoresFromState,
    dailyReportItemFromPgRow,
    DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN,
    filterStaleHeartbeats,
    formatStaleHeartbeatDeadLabel,
    staleHeartbeatDedupeKey,
  };

  async function beatHeartbeat(taskName) {
    return beatHeartbeatImpl(bound, taskName);
  }

  async function startListenMonitors() {
    bindDailyReportsRuntimeDeps({
      pool,
      hrmsNowISO: hrmsNowISO || (() => new Date().toISOString()),
      getSharedState,
      safeDateOnly: (v) => String(v || '').trim().slice(0, 10),
    });

    scheduleSessionStatePurge(bound);
    await scheduleCacheAndHeartbeat(bound);
    scheduleCriticalDataReconcile(bound);
    schedulePosSalesCheck(bound);
    scheduleLeaveCumulativeSnapshot(bound);
  }

  return { beatHeartbeat, startListenMonitors };
}
