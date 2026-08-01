/**
 * 定时任务心跳过期检测——供 /api/health 用，回答"这个任务是不是已经该跑但没跑成功"。
 *
 * 背景（2026-08-01）：leave_cumulative_snapshot 和 sales-ai 的几个定时任务此前完全没有
 * 心跳记录，今天连续失败/未执行了很长时间都没人发现，是靠用户自己截图反馈才查出来的。
 * 这个模块把 scheduler_heartbeat 表里各任务的 last_beat 跟"预期最大间隔"比对，超过阈值
 * 就判定为 stale，暴露给 /api/health，让"任务没跑"这件事能被主动发现，而不是被动等用户投诉。
 *
 * 阈值刻意给得比任务本身的调度周期宽松（比如"每月1号"的任务给45天而不是31天），避免月末/
 * 月初边界或服务重启导致的正常延迟被误报；核心目的是抓"真的停摆了"，不是精确对时。
 */

/** task_name → 预期最大间隔（分钟）。新增定时任务记得心跳(见 monitor-beat.js#beatHeartbeat
 * 或本文件同款 UPSERT 写法)+ 在这里登记预期间隔，否则不会被 staleness 检测覆盖。 */
export const SCHEDULER_HEARTBEAT_EXPECTATIONS_MIN = {
  cache_purge: 30,
  critical_data_reconcile: 60,
  hrms_performance_jobs_tick: 30,
  pos_sales_check: 60 * 26, // 每日 23:30-23:34 窗口，给26h容错
  leave_cumulative_snapshot: 60 * 24 * 45, // 每月1号 06:00-06:14
  __salesDailyReportTimer: 60 * 26,
  __salesRepActivityRollupTimer: 60 * 26,
  __salesWeeklyKpiTimer: 60 * 24 * 9, // 每周一，给9天容错
  __salesMonthlyKpiTimer: 60 * 24 * 45,
};

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ ok: boolean, stale: Array<{task_name:string, last_beat:string|null, ageMinutes:number|null, expectedMaxMinutes:number}>, checked: number, error?: string }>}
 */
export async function checkSchedulerHeartbeatStaleness(pool) {
  try {
    const r = await pool.query(`SELECT task_name, last_beat FROM scheduler_heartbeat`);
    const byTask = new Map((r.rows || []).map((row) => [row.task_name, row.last_beat]));
    const now = Date.now();
    const stale = [];
    for (const [taskName, expectedMaxMinutes] of Object.entries(SCHEDULER_HEARTBEAT_EXPECTATIONS_MIN)) {
      const lastBeat = byTask.get(taskName) || null;
      const ageMinutes = lastBeat ? Math.round((now - new Date(lastBeat).getTime()) / 60000) : null;
      if (ageMinutes == null || ageMinutes > expectedMaxMinutes) {
        stale.push({
          task_name: taskName,
          last_beat: lastBeat ? new Date(lastBeat).toISOString() : null,
          ageMinutes,
          expectedMaxMinutes,
        });
      }
    }
    return { ok: stale.length === 0, stale, checked: Object.keys(SCHEDULER_HEARTBEAT_EXPECTATIONS_MIN).length };
  } catch (e) {
    return { ok: false, stale: [], checked: 0, error: String(e?.message || e) };
  }
}
