/**
 * Extracted from createListenMonitors — P5.4.
 */
import { childLogger } from '../../utils/logger.js';
const log = childLogger({ domain: 'health', handler: 'startup-monitors' });

export async function scheduleCacheAndHeartbeat(deps) {
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

// ── P0-3: 定时任务心跳表（表结构由 migrate / 093 等提供；启动仅在允许 schema 变更时 ensure）──
if (allowSchemaChanges) {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduler_heartbeat (
        task_name   TEXT PRIMARY KEY,
        last_beat   TIMESTAMPTZ DEFAULT NOW(),
        run_count   BIGINT DEFAULT 0
      )
    `);
    log.info({ msg: 'monitor', detail: ['[monitor] scheduler_heartbeat table ready'].map((x) => (x == null ? '' : String(x))).join(' ') });
  } catch (e) {
    log.error({ msg: 'monitor', detail: ['[monitor] heartbeat table init error:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
  }
}

const HEARTBEAT_ALERT_THRESHOLDS_MIN = DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN;
const heartbeatAlertDedup = new Map();

// 带心跳的缓存清理（覆盖原 setInterval）
// agent_metric_cache 带tenant_id/RLS，原只清default租户会导致其他租户缓存堆积不过期；改为遍历活跃租户。
// 心跳(beatHeartbeat)本身是系统级监控，不依赖租户上下文，仍在租户循环外单独打一次。
const runCachePurge = async () => {
  try {
    await runForActiveTenants(() => purgeExpiredCache().catch(() => {}), { continueOnError: true });
  } catch (e) {
    log.error({ msg: 'monitor', detail: ['[cache_purge] runForActiveTenants error:', e?.message || e].map((x) => (x == null ? '' : String(x))).join(' ') });
  }
  await beatHeartbeat('cache_purge');
};
setIntervalFn(runCachePurge, 2 * 60 * 60 * 1000);
// 启动即执行一次并写心跳，避免重启后首个 2 小时窗口误判为“任务停摆”
setTimeoutFn(runCachePurge, 15 * 1000);

// ── P0-3: 每 30 分钟检查心跳是否存活 ────────────────────────
setIntervalFn(async () => {
  await runWithBootstrapTenantContext(async () => {
    try {
      const r = await pool.query(`
        SELECT task_name,
               EXTRACT(EPOCH FROM (NOW() - last_beat)) / 60 AS minutes_ago
        FROM scheduler_heartbeat
      `);
      const staleRows = filterStaleHeartbeats(r.rows || [], HEARTBEAT_ALERT_THRESHOLDS_MIN);
      if (staleRows.length > 0) {
        const dead = formatStaleHeartbeatDeadLabel(staleRows);
        const dedupeKey = staleHeartbeatDedupeKey(staleRows);
        const lastSent = Number(heartbeatAlertDedup.get(dedupeKey) || 0);
        if (Date.now() - lastSent < 2 * 60 * 60 * 1000) return;
        heartbeatAlertDedup.set(dedupeKey, Date.now());
        const msg = `🚨 [HRMS] 定时任务心跳异常\n停止任务：${dead}\n请登录服务器检查：\nsystemctl status hrms.service`;
        log.error({ msg: 'monitor', detail: ['[monitor] Dead tasks:', dead].map((x) => (x == null ? '' : String(x))).join(' ') });
        await sendSystemAlert(msg);
      }
    } catch (e) {
      log.error({ msg: 'monitor', detail: ['[monitor] heartbeat check error:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
    }
  });
}, 30 * 60 * 1000);
}
