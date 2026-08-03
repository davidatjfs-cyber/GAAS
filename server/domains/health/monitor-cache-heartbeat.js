/**
 * Extracted from createListenMonitors — P5.4.
 */
import { childLogger } from '../../utils/logger.js';
import { wasRecentlyFiredPersisted, markFiredPersisted } from './monitor-beat.js';
const log = childLogger({ domain: 'health', handler: 'startup-monitors' });

export async function scheduleCacheAndHeartbeat(deps) {
  const {
    pool, runForActiveTenants, runWithBootstrapTenantContext, getSharedState: _getSharedState,
    mergeSharedStateFields: _mergeSharedStateFields, purgeExpiredCache, upsertLeaveDomainFromState: _upsertLeaveDomainFromState,
    upsertPayrollDomainFromState: _upsertPayrollDomainFromState, getExpectedMonthlyPerformancePeriodShanghai: _getExpectedMonthlyPerformancePeriodShanghai,
    countEligibleMonthlyPerformanceUsers: _countEligibleMonthlyPerformanceUsers, leaveAttendanceHelpers: _leaveAttendanceHelpers, safeErrMessage: _safeErrMessage,
    allowSchemaChanges, setIntervalFn = setInterval, setTimeoutFn = setTimeout,
    beatHeartbeat, sendSystemAlert,
    isPosSalesCheckWindow: _isPosSalesCheckWindow, isLeaveCumulativeSnapshotWindow: _isLeaveCumulativeSnapshotWindow,
    findMissingPosStores: _findMissingPosStores, expectedStoresFromState: _expectedStoresFromState,
    dailyReportItemFromPgRow: _dailyReportItemFromPgRow,
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
      // 2026-08-03 修复："定时任务心跳异常"告警刷屏且task_name越报越长/越报越乱
      // （如"heartbeat_alert_heartbeat_alert_freshness_alert_default:11:6"）——查证根因：
      // 这条SQL之前不带WHERE，扫描scheduler_heartbeat全表，把本session之前为"数据新鲜度
      // 告警"/"POS销售检查"去重加的持久化标记(freshness_alert_${tenantId}、
      // pos_sales_check_fired_${tenantId}，见scheduler-freshness.js/monitor-pos-sales.js)
      // 也当成"该定期心跳的任务"来判断——这些标记只在告警真正触发时才写一次，不是周期性
      // 任务，不在HEARTBEAT_ALERT_THRESHOLDS_MIN白名单里，一律落到default:180分钟阈值，
      // 写入后180分钟必然被判定"停摆"。更糟的是：本函数自己的去重key
      // (`heartbeat_alert_${dedupeKey}`)也写回了同一张表，下一轮扫描又把这个key本身当成
      // "停摆任务"之一，dedupeKey又是由"当前所有停摆任务名"拼出来的，于是名字一轮比一轮长、
      // 一轮比一轮乱，形成自我循环放大。改成只查HEARTBEAT_ALERT_THRESHOLDS_MIN白名单里
      // 登记过的真实周期性任务，其它任何一次性去重标记/本函数自身的dedupe key都不会再被
      // 当作"心跳任务"来判断是否停摆。
      const knownTaskNames = Object.keys(HEARTBEAT_ALERT_THRESHOLDS_MIN).filter((k) => k !== 'default');
      const r = await pool.query(`
        SELECT task_name,
               EXTRACT(EPOCH FROM (NOW() - last_beat)) / 60 AS minutes_ago
        FROM scheduler_heartbeat
        WHERE task_name = ANY($1::text[])
      `, [knownTaskNames]);
      const staleRows = filterStaleHeartbeats(r.rows || [], HEARTBEAT_ALERT_THRESHOLDS_MIN);
      if (staleRows.length > 0) {
        const dead = formatStaleHeartbeatDeadLabel(staleRows);
        const dedupeKey = staleHeartbeatDedupeKey(staleRows);
        // 2026-08-01 修复：heartbeatAlertDedup 是进程内 Map，pm2 restart 就清零——生产实测
        // 同一次"心跳异常"检测因为重启在同一时间戳被插入了两条一模一样的通知。改成持久化
        // 去重（复用 monitor-beat.js 的 wasRecentlyFiredPersisted），reason 见该函数注释。
        if (await wasRecentlyFiredPersisted(pool, `heartbeat_alert_${dedupeKey}`, 2 * 60)) return;
        await markFiredPersisted(pool, `heartbeat_alert_${dedupeKey}`);
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
