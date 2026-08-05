/**
 * 定时任务心跳过期检测——供 /api/health 用，回答"这个任务是不是已经该跑但没跑成功"。
 *
 * 背景（2026-08-01）：leave_cumulative_snapshot 和 sales-ai 的几个定时任务此前完全没有
 * 心跳记录，今天连续失败/未执行了很长时间都没人发现，是靠用户自己截图反馈才查出来的。
 * 这个模块把 scheduler_heartbeat 表里各任务的 last_beat 跟"预期最大间隔"比对，超过阈值
 * 就判定为异常，暴露给 /api/health，让"任务没跑"这件事能被主动发现，而不是被动等用户投诉。
 *
 * 2026-08-05 重构：预期间隔本来在本文件手写一份（cache_purge=30），跟告警侧那份
 * （cache_purge=390）打架，而 cache_purge 真实周期是 2 小时——于是 /api/health 的
 * schedulerHeartbeats.ok 长期为 false，红灯常态化，等于没有监控。现在统一从
 * scheduler-registry.js 读取，判定逻辑也收敛到 evaluateSchedulerHealth：
 * 缺心跳行不再被静默忽略，而是按 never 报出来（带进程运行时长宽限，避免重启后误报）。
 */
import { evaluateSchedulerHealth, buildThresholdMap } from './scheduler-registry.js';

/** @deprecated 保留导出仅为兼容；预期间隔的唯一事实来源是 scheduler-registry.js。 */
export const SCHEDULER_HEARTBEAT_EXPECTATIONS_MIN = buildThresholdMap();

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{
 *   ok: boolean,
 *   stale: Array<{task_name:string, status:string, last_beat:string|null, ageMinutes:number|null, expectedMaxMinutes:number}>,
 *   checked: number,
 *   tasks?: Array<object>,
 *   error?: string
 * }>}
 */
export async function checkSchedulerHeartbeatStaleness(pool) {
  try {
    const r = await pool.query(`SELECT task_name, last_beat, status, last_error, duration_ms, last_success_at FROM scheduler_heartbeat`);
    const result = evaluateSchedulerHealth({
      rows: r.rows || [],
      uptimeMs: process.uptime() * 1000,
    });
    // 保持 /api/health 既有字段名（ok/stale/checked）不变，避免破坏已有消费方；
    // stale 的语义扩展为 "overdue + never"，并额外带上 status 让面板能区分两者。
    return {
      ok: result.ok,
      stale: result.unhealthy.map((t) => ({
        task_name: t.task_name,
        status: t.status,
        last_beat: t.last_beat,
        ageMinutes: t.ageMinutes,
        expectedMaxMinutes: t.expectedMaxMinutes,
      })),
      checked: result.checked,
      tasks: result.tasks,
    };
  } catch (e) {
    return { ok: false, stale: [], checked: 0, error: String(e?.message || e) };
  }
}
