/**
 * 定时任务心跳：过期判定纯函数（从 index.js listen 块抽出，便于单测）。
 */

// 2026-08-01 修复：今天系统性排查给一批"日/周/月频"任务补心跳时，直接漏看了这份阈值表——
// 没登记的 task_name 一律落到 default(180分钟=3小时)，而这些任务本来就是几小时到一个月
// 才跑一次，一上线立刻被判定成"停摆"，刷屏发了一堆假告警。阈值按各任务真实调度周期的
// 1.5-2 倍留余量（重启/偶发延迟不误报，真正停摆超过一个完整周期才报）。
export const DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN = {
  cache_purge: 390,
  pos_sales_check: 72 * 60,
  sms_template_reconcile: 36 * 60, // 每24h一次
  schema_migration_drift_check: 12 * 60, // 每6h一次
  pos_feishu_sync_cron: 30 * 60, // 每日一次（内层setInterval是1min tick，但实际同步逻辑按天门控）
  health_sla_reminder_daily: 30 * 60, // 每日9-20h窗口内一次
  health_queue_digest_daily: 30 * 60, // 每日一次
  leave_cumulative_snapshot: 45 * 24 * 60, // 每月1号一次
  __salesDailyReportTimer: 30 * 60,
  __salesRepActivityRollupTimer: 30 * 60,
  __salesWeeklyKpiTimer: 9 * 24 * 60, // 每周一次
  __salesMonthlyKpiTimer: 45 * 24 * 60, // 每月一次
  master_kg_health_tick: 12 * 60, // master-agent内部tick，每6h一次
  default: 180,
};

/**
 * @param {Array<{ task_name?: string, minutes_ago?: number|string }>} rows
 * @param {Record<string, number>} [thresholdsMin]
 * @returns {Array<{ task_name: string, minutes_ago: number }>}
 */
export function filterStaleHeartbeats(rows, thresholdsMin = DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN) {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((row) => ({
      task_name: String(row?.task_name || '').trim(),
      minutes_ago: Number(row?.minutes_ago || 0),
    }))
    .filter((row) => {
      if (!row.task_name) return false;
      const th = Number(thresholdsMin[row.task_name] || thresholdsMin.default);
      return Number.isFinite(row.minutes_ago) && Number.isFinite(th) && row.minutes_ago >= th;
    });
}

/**
 * @param {Array<{ task_name: string, minutes_ago: number }>} staleRows
 */
export function formatStaleHeartbeatDeadLabel(staleRows) {
  return (staleRows || [])
    .map((row) => `${row.task_name}（${Math.floor(Number(row.minutes_ago || 0))}分钟前）`)
    .join('、');
}

/**
 * 30 分钟桶去重 key，避免同一批僵死任务刷屏。
 * @param {Array<{ task_name: string, minutes_ago: number }>} staleRows
 */
export function staleHeartbeatDedupeKey(staleRows) {
  return (staleRows || [])
    .map((row) => `${row.task_name}:${Math.floor(Number(row.minutes_ago || 0) / 30)}`)
    .join('|');
}
