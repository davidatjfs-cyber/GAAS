/**
 * 定时任务心跳：过期判定纯函数（从 index.js listen 块抽出，便于单测）。
 */

export const DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN = {
  cache_purge: 390,
  pos_sales_check: 72 * 60,
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
