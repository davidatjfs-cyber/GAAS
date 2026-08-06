/**
 * 定时任务注册表 —— 「本系统应该有哪些定时任务」的唯一事实来源。
 *
 * 背景（2026-08-05 核查）：此前"预期间隔"分散在两处且互相打架——
 *   - scheduler-heartbeat.js#DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN（告警用，cache_purge=390）
 *   - scheduler-heartbeat-status.js#SCHEDULER_HEARTBEAT_EXPECTATIONS_MIN（/api/health 用，cache_purge=30）
 * cache_purge 实际每 2 小时跑一次，于是 /api/health 的 schedulerHeartbeats.ok 长期为 false，
 * 这个信号失去意义。现在两边都从本文件派生，只有一个数字。
 *
 * 更严重的问题：告警 SQL 是 `WHERE task_name = ANY(白名单)`，**没有心跳行就查不出来**，
 * 于是「登记了但一次都没跑过」的任务（master_kg_health_tick / sms_template_reconcile /
 * leave_cumulative_snapshot 在生产实测就是 0 行）永远不会告警——任务彻底停摆时监控最安静。
 * 本文件改成注册表驱动：**以注册表为准去比对心跳表，缺行 = 异常**，而不是以心跳表为准。
 *
 * 新增定时任务的纪律：打心跳（monitor-beat.js#beatHeartbeat / beatHeartbeatSimple）+ 在本表登记。
 * 只做其一都会留下盲区：只打心跳 → 不被检测；只登记 → 永远报 never。
 */
import { buildMasterIntervalSchedule } from '../master-agent/start-ticks.js';
import { isAgentSchedulingDisabled } from '../shared/startup-agent-schema-helpers.js';

/**
 * @typedef {Object} SchedulerRegistryEntry
 * @property {string} name             心跳 task_name
 * @property {string} schedule         人类可读的调度周期（面板展示用）
 * @property {number} expectedMaxMinutes 超过这个时长没有成功心跳即判定异常。
 *   刻意给到真实周期的 1.5–3 倍：重启/偶发延迟不误报，真正停摆超过一个完整周期才报。
 * @property {'gaas'|'agents-service-v2'} owner 实际执行方
 * @property {string} [group]          面板分组
 * @property {(env: Record<string, string|undefined>) => boolean} [delegatedWhen]
 *   返回 true 表示当前环境下本服务不负责执行（已委托给另一服务），不参与存活判定
 */

/** GAAS 自己执行的定时任务。expectedMaxMinutes 已按代码里的真实 interval 校准（见每行注释）。 */
const GAAS_SCHEDULERS = [
  // ── 高频 tick（分钟级）
  { name: 'agent_autonomous_scheduler_tick', schedule: '每 1 分钟', expectedMaxMinutes: 15, group: 'agent', owner: 'gaas' },
  { name: 'sms_templates_cache_refresh', schedule: '每 1 分钟', expectedMaxMinutes: 15, group: '短信', owner: 'gaas' },
  { name: 'hrms_performance_jobs_tick', schedule: '每 5 分钟', expectedMaxMinutes: 20, group: '绩效', owner: 'gaas' },
  { name: 'critical_data_reconcile', schedule: '每 10 分钟', expectedMaxMinutes: 35, group: '数据一致性', owner: 'gaas' },
  { name: 'growth_phase_cron_tick', schedule: '每 10 分钟', expectedMaxMinutes: 35, group: '增长', owner: 'gaas' },
  { name: 'sms_health_monitor', schedule: '每 30 分钟', expectedMaxMinutes: 90, group: '短信', owner: 'gaas' },

  // ── 小时级
  { name: 'training_reminder_scheduler_tick', schedule: '每 1 小时', expectedMaxMinutes: 150, group: '培训', owner: 'gaas' },
  // 2026-08-05：实际 setInterval 是 2 小时（monitor-cache-heartbeat.js:52），此前 /api/health
  // 按 30 分钟判定，导致长期误报 stale。统一取 390（≈3 个周期）。
  { name: 'cache_purge', schedule: '每 2 小时', expectedMaxMinutes: 390, group: '运维', owner: 'gaas' },
  { name: 'schema_migration_drift_check', schedule: '每 6 小时', expectedMaxMinutes: 12 * 60, group: '运维', owner: 'gaas' },

  // ── 每日
  { name: 'pos_sales_check', schedule: '每日 23:30', expectedMaxMinutes: 26 * 60, group: 'POS', owner: 'gaas' },
  { name: 'pos_feishu_sync_cron', schedule: '每日一次', expectedMaxMinutes: 30 * 60, group: 'POS', owner: 'gaas' },
  { name: 'health_sla_reminder_daily', schedule: '每日 9-20 点窗口', expectedMaxMinutes: 30 * 60, group: '运维', owner: 'gaas' },
  { name: 'health_queue_digest_daily', schedule: '每日一次', expectedMaxMinutes: 30 * 60, group: '运维', owner: 'gaas' },
  { name: '__salesDailyReportTimer', schedule: '每日一次', expectedMaxMinutes: 26 * 60, group: '销售', owner: 'gaas' },
  { name: '__salesRepActivityRollupTimer', schedule: '每日一次', expectedMaxMinutes: 26 * 60, group: '销售', owner: 'gaas' },

  // ── 周/月
  { name: '__salesWeeklyKpiTimer', schedule: '每周一次', expectedMaxMinutes: 9 * 24 * 60, group: '销售', owner: 'gaas' },
  { name: '__salesMonthlyKpiTimer', schedule: '每月一次', expectedMaxMinutes: 45 * 24 * 60, group: '销售', owner: 'gaas' },
  { name: 'leave_cumulative_snapshot', schedule: '每月 1 号 06:00', expectedMaxMinutes: 45 * 24 * 60, group: '考勤', owner: 'gaas' },
];

/**
 * master-agent 的 16 个 tick。**从 buildMasterIntervalSchedule 派生**而不是手抄，
 * 避免 start-ticks.js 增删 tick 后本表悄悄过期。
 * 生产 DISABLE_AGENT_SCHEDULING=true → 这些 tick 由 agents-service-v2 执行，
 * GAAS 侧不会有心跳行；此时标记为 delegated 而非 never，避免每 2 小时刷一次假告警。
 */
const MASTER_SCHEDULERS = buildMasterIntervalSchedule({}).map((entry) => ({
  name: entry.name,
  schedule: formatIntervalMs(entry.intervalMs),
  expectedMaxMinutes: Math.max(30, Math.round((entry.intervalMs / 60000) * 3)),
  group: 'master-agent',
  owner: 'gaas',
  delegatedWhen: (env) => isAgentSchedulingDisabled(env?.DISABLE_AGENT_SCHEDULING),
}));

function formatIntervalMs(ms) {
  const min = Number(ms) / 60000;
  if (min < 1) return `每 ${Math.round(Number(ms) / 1000)} 秒`;
  if (min < 60) return `每 ${Math.round(min)} 分钟`;
  return `每 ${Math.round(min / 60)} 小时`;
}

/** @type {SchedulerRegistryEntry[]} */
export const SCHEDULER_REGISTRY = [...GAAS_SCHEDULERS, ...MASTER_SCHEDULERS];

/** task_name → expectedMaxMinutes，供仍按阈值表工作的老调用方派生使用。 */
export function buildThresholdMap(registry = SCHEDULER_REGISTRY) {
  const map = {};
  for (const entry of registry) map[entry.name] = entry.expectedMaxMinutes;
  return map;
}

/**
 * 比对注册表与心跳表，给出每个任务的状态。
 *
 * 状态语义（面板/告警都用这一套）：
 *  - ok        ：最近一次心跳在预期窗口内，且最近一次执行是成功的
 *  - overdue   ：有心跳记录，但已超过预期最大间隔 → 该跑没跑
 *  - failing   ：准时在跑，但最近一次执行失败 / 距上次成功已超过一个预期周期 → 跑了但没产出
 *  - never     ：注册表里有、心跳表里一行都没有，且进程已运行超过一个预期周期 → 从未成功执行
 *  - delegated ：当前环境下已委托给另一服务执行，本服务不做判定
 *
 * `failing` 是此前完全看不见的一类故障：任务准时触发、心跳照跳，但内部每次抛异常，
 * 业务产出为零，从 last_beat 角度看却完全健康。依赖 migration 180 的 status/last_success_at。
 *
 * `never` 的进程运行时长门槛很关键：leave_cumulative_snapshot 这类每月只跑一次的任务，
 * 服务刚重启时本来就还没到执行时间，不给宽限期会一上线就报假警。
 *
 * @param {{
 *   rows?: Array<{ task_name?: string, last_beat?: string|Date|null, status?: string|null,
 *                  last_success_at?: string|Date|null, last_error?: string|null }>,
 *   registry?: SchedulerRegistryEntry[],
 *   nowMs?: number,
 *   uptimeMs?: number,
 *   env?: Record<string, string|undefined>,
 * }} input
 */
export function evaluateSchedulerHealth(input = {}) {
  const {
    rows = [],
    registry = SCHEDULER_REGISTRY,
    nowMs = Date.now(),
    uptimeMs = Number.POSITIVE_INFINITY,
    env = process.env,
  } = input;

  const byTask = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.task_name)
      .map((row) => [String(row.task_name), row])
  );

  const ageMinutesOf = (value) => {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? Math.round((nowMs - ms) / 60000) : null;
  };

  const tasks = registry.map((entry) => {
    const base = {
      task_name: entry.name,
      schedule: entry.schedule,
      group: entry.group || 'other',
      owner: entry.owner,
      expectedMaxMinutes: entry.expectedMaxMinutes,
      last_beat: null,
      ageMinutes: null,
    };

    if (typeof entry.delegatedWhen === 'function' && entry.delegatedWhen(env)) {
      return { ...base, status: 'delegated' };
    }

    const row = byTask.get(entry.name) ?? null;
    if (!row || !row.last_beat) {
      // 进程还没运行满一个预期周期 → 尚不能断定"没跑"，先按 ok 处理。
      const status = uptimeMs >= entry.expectedMaxMinutes * 60000 ? 'never' : 'ok';
      return { ...base, status };
    }

    const ageMinutes = ageMinutesOf(row.last_beat);
    const successAgeMinutes = ageMinutesOf(row.last_success_at);
    const withRow = {
      ...base,
      last_beat: ageMinutes == null ? null : new Date(row.last_beat).toISOString(),
      ageMinutes,
      successAgeMinutes,
      last_error: row.last_error || null,
      duration_ms: row.duration_ms ?? null,
    };

    if (ageMinutes != null && ageMinutes > entry.expectedMaxMinutes) {
      return { ...withRow, status: 'overdue' };
    }
    // 心跳新鲜但执行失败，或距上次成功已超过一个完整周期 → 在跑但没产出。
    // last_success_at 为空视为存量未回填，不据此判定（migration 180 已做回填）。
    const failing = row.status === 'error'
      || (successAgeMinutes != null && successAgeMinutes > entry.expectedMaxMinutes);
    return { ...withRow, status: failing ? 'failing' : 'ok' };
  });

  const UNHEALTHY = new Set(['overdue', 'never', 'failing']);
  // 2026-08-06 去重叠：委托给 agents-service-v2 执行的任务不再出现在 GAAS 的输出里。
  // 之前它们以 delegated 行的形式混在 tasks 中，等于 GAAS 的面板/health 里挂着 16 行
  // 别人家的任务——V2 侧有自己的 cron 监控（agent_v2_cron_runs + 失败即时飞书告警）
  // 和自己的面板，两边都列同一批任务只会让"谁该管"变模糊。注册表仍保留这些条目，
  // 这样万一 DISABLE_AGENT_SCHEDULING 翻回 false（GAAS 自己执行），它们会自动回到判定范围。
  const owned = tasks.filter((t) => t.status !== 'delegated');
  const unhealthy = owned.filter((t) => UNHEALTHY.has(t.status));
  return {
    ok: unhealthy.length === 0,
    checked: owned.length,
    tasks: owned,
    /** 仅供排查时确认"这批任务确实是有意交给 V2 的"，不参与任何判定与展示 */
    delegatedToOtherService: tasks.filter((t) => t.status === 'delegated').map((t) => t.task_name),
    unhealthy,
  };
}
