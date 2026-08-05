/**
 * 定时任务心跳：过期判定纯函数（从 index.js listen 块抽出，便于单测）。
 */
import { buildThresholdMap } from './scheduler-registry.js';

// 2026-08-01 修复：今天系统性排查给一批"日/周/月频"任务补心跳时，直接漏看了这份阈值表——
// 没登记的 task_name 一律落到 default(180分钟=3小时)，而这些任务本来就是几小时到一个月
// 才跑一次，一上线立刻被判定成"停摆"，刷屏发了一堆假告警。阈值按各任务真实调度周期的
// 1.5-2 倍留余量（重启/偶发延迟不误报，真正停摆超过一个完整周期才报）。
//
// 2026-08-05：阈值不再在本文件手写，改为从 scheduler-registry.js 派生——此前本表与
// scheduler-heartbeat-status.js 各写一份且互相打架（cache_purge 390 vs 30），/api/health
// 因此长期误报。注册表是唯一事实来源，新增任务只需改那一处。
export const DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN = {
  ...buildThresholdMap(),
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
 * 2026-08-05：告警文案区分两种异常——「有过心跳但已停摆」给出距上次多久，
 * 「注册了但一行心跳都没有」标成"从未执行"。后者以前根本报不出来，现在既然能报出来，
 * 就不能和前者混成同一句话，否则运维会按"重启一下"的思路去处理一个从来没启动过的任务。
 * @param {Array<{ task_name: string, minutes_ago: number, status?: string }>} staleRows
 */
export function formatStaleHeartbeatDeadLabel(staleRows) {
  return (staleRows || [])
    .map((row) => {
      if (row?.status === 'never') return `${row.task_name}（从未执行）`;
      const ago = `${Math.floor(Number(row.minutes_ago || 0))}分钟前`;
      if (row?.status === 'failing') return `${row.task_name}（在跑但失败，最近一次${ago}）`;
      return `${row.task_name}（${ago}）`;
    })
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
