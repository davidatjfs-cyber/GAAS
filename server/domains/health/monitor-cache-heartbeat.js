/**
 * Extracted from createListenMonitors — P5.4.
 */
import { childLogger } from '../../utils/logger.js';
import { wasRecentlyFiredPersisted, markFiredPersisted } from './monitor-beat.js';
import { evaluateSchedulerHealth } from './scheduler-registry.js';
import { collectOutputFreshness, formatStaleOutputAlert, staleOutputDedupeKey } from '../scheduler-ops/service.js';
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
    // 2026-08-05：阈值表与 filterStaleHeartbeats 已被 scheduler-registry.js 的
    // evaluateSchedulerHealth 取代（见下方心跳检查注释），保留解构仅为不改调用方签名。
    DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN: _DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN,
    filterStaleHeartbeats: _filterStaleHeartbeats,
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
      //
      // 2026-08-05 修复（比上面那轮更根本）：上面这条 SQL 的 WHERE 白名单虽然挡住了刷屏，
      // 却引入了一个更危险的反向漏洞——**心跳表里没有这一行时，查询结果就没有这个任务，
      // 于是它永远不会被判定为停摆**。生产实测 master_kg_health_tick / sms_template_reconcile
      // / leave_cumulative_snapshot 三个任务在白名单里登记着、心跳表里 0 行，等于"任务彻底
      // 没跑"时监控反而最安静。现在改成以 scheduler-registry.js 注册表为准去比对心跳表：
      // 缺行 = never（进程运行时长不足一个周期时给宽限，避免重启后误报），
      // 已委托给 agents-service-v2 的 tick 标记 delegated 不参与判定。
      const r = await pool.query(`SELECT task_name, last_beat, status, last_error, duration_ms, last_success_at FROM scheduler_heartbeat`);
      const evaluated = evaluateSchedulerHealth({
        rows: r.rows || [],
        uptimeMs: process.uptime() * 1000,
      });
      const toAlertRow = (t) => ({
        task_name: t.task_name,
        // never 没有 last_beat，用预期间隔占位，让告警文案与去重 key 仍可计算
        minutes_ago: t.ageMinutes == null ? t.expectedMaxMinutes : t.ageMinutes,
        status: t.status,
      });
      // never 的冷却时间给到 24h：它描述的是"一直就没跑过"这种稳态，按 2h 重复播报没有
      // 任何新信息，只会复刻本文件历史上反复出现过的告警刷屏。overdue/failing 是新出现的
      // 状态变化，保持 2h。
      const buckets = [
        { rows: evaluated.unhealthy.filter((t) => t.status !== 'never').map(toAlertRow), cooldownMin: 2 * 60, title: '定时任务心跳异常' },
        { rows: evaluated.unhealthy.filter((t) => t.status === 'never').map(toAlertRow), cooldownMin: 24 * 60, title: '定时任务从未执行' },
      ];
      for (const bucket of buckets) {
        if (bucket.rows.length === 0) continue;
        const dead = formatStaleHeartbeatDeadLabel(bucket.rows);
        const dedupeKey = staleHeartbeatDedupeKey(bucket.rows);
        // 2026-08-01 修复：heartbeatAlertDedup 是进程内 Map，pm2 restart 就清零——生产实测
        // 同一次"心跳异常"检测因为重启在同一时间戳被插入了两条一模一样的通知。改成持久化
        // 去重（复用 monitor-beat.js 的 wasRecentlyFiredPersisted），reason 见该函数注释。
        if (await wasRecentlyFiredPersisted(pool, `heartbeat_alert_${dedupeKey}`, bucket.cooldownMin)) continue;
        await markFiredPersisted(pool, `heartbeat_alert_${dedupeKey}`);
        const msg = `🚨 [HRMS] ${bucket.title}\n涉及任务：${dead}\n请登录服务器检查：\nsystemctl status hrms.service`;
        log.error({ msg: 'monitor', detail: ['[monitor] Dead tasks:', dead].map((x) => (x == null ? '' : String(x))).join(' ') });
        await sendSystemAlert(msg);
      }

      // 2026-08-05 P3：心跳只能证明"函数被调用过"。BI 异常扣分这类任务可能准时触发、
      // 心跳照跳，但内部查不到数据/写库失败，结果 agent_scores 一行新数据都没有而监控全绿。
      // 这里直接断言业务表的产出新鲜度——看产出不看过程，也是唯一能覆盖 agents-service-v2
      // 侧任务的手段（那些 tick 跑在另一个进程，GAAS 拿不到心跳，但共用同一个库）。
      const outputs = await collectOutputFreshness(pool);
      const staleOutputs = outputs.filter((o) => o.status === 'stale' || o.status === 'error');
      if (staleOutputs.length > 0) {
        const outputKey = `output_freshness_${staleOutputDedupeKey(staleOutputs)}`;
        // 产出断档是"天级"问题（周度任务断一次要等下周才可能恢复），6h 冷却足够，
        // 按 2h 播报只会重复同一条没有新信息的消息。
        if (!(await wasRecentlyFiredPersisted(pool, outputKey, 6 * 60))) {
          await markFiredPersisted(pool, outputKey);
          const detail = formatStaleOutputAlert(staleOutputs);
          log.error({ msg: 'monitor', detail: `[monitor] stale outputs: ${staleOutputs.map((o) => o.key).join(',')}` });
          await sendSystemAlert(`🚨 [HRMS] 业务产出断档（任务可能在跑但没出数据）\n${detail}`);
        }
      }
    } catch (e) {
      log.error({ msg: 'monitor', detail: ['[monitor] heartbeat check error:', e?.message].map((x) => (x == null ? '' : String(x))).join(' ') });
    }
  });
}, 30 * 60 * 1000);
}
