/**
 * 通知发送熔断器（进程内内存实现，单实例 pm2 场景足够）。
 *
 * 背景（2026-08-01）：sales-ai 的月度/周度 KPI 结算定时任务因 setTimeout 32位溢出，
 * 立即触发→重新调度→再次溢出立即触发，死循环疯狂重复发送同一条飞书消息，管理员被刷屏。
 * 根因已修（见 domains/sales-ai/routes-schedulers.js 的 safeSetTimeout），但这类"未知 bug
 * 导致同一条消息短时间内被重复触发"的风险无法穷举排除——熔断器是最后一道兜底：不管上游
 * 是什么原因导致重复调用，同一个 key 在时间窗口内超过阈值就直接拦截，不再新开线程排查，
 * 先止血。
 *
 * 用法：每次准备发送前调用 checkNotifyCircuitBreaker(key, opts)，key 建议用"这条消息的
 * 内容指纹"（如标题/前缀 + 收件人），不要用时间戳等每次都不同的值，否则永远不会触发限流。
 */

const _windows = new Map();

/** 定期清理长期不活跃的 key，避免内存无限增长（每次调用时惰性清理，不额外起定时器）。 */
function pruneStale(now, staleAfterMs) {
  for (const [key, w] of _windows) {
    if (now - w.windowStart > staleAfterMs) _windows.delete(key);
  }
}

/**
 * @param {string} key 消息指纹（同一类/同一条消息应产生相同 key）
 * @param {{ maxPerWindow?: number, windowMs?: number }} [opts]
 *   maxPerWindow: 窗口内允许发送的最大次数，默认 5
 *   windowMs: 窗口长度（毫秒），默认 5 分钟
 * @returns {{ allowed: boolean, justTripped: boolean, count: number }}
 *   allowed=false 时调用方应跳过真正的外部发送（Feishu API 调用等）。
 *   justTripped=true 表示这是本窗口内第一次越过阈值——调用方可以借这个信号发一条
 *   "已自动限流"的提示（且仅这一次，不会随后续调用重复提示）。
 */
export function checkNotifyCircuitBreaker(key, opts = {}) {
  const maxPerWindow = Number.isFinite(opts.maxPerWindow) ? opts.maxPerWindow : 5;
  const windowMs = Number.isFinite(opts.windowMs) ? opts.windowMs : 5 * 60 * 1000;
  const k = String(key || 'default').trim() || 'default';
  const now = Date.now();
  if (_windows.size > 500) pruneStale(now, windowMs * 4);

  let w = _windows.get(k);
  if (!w || now - w.windowStart > windowMs) {
    w = { count: 0, windowStart: now, tripped: false };
    _windows.set(k, w);
  }
  w.count += 1;
  if (w.count > maxPerWindow) {
    const wasTripped = w.tripped;
    w.tripped = true;
    return { allowed: false, justTripped: !wasTripped, count: w.count };
  }
  return { allowed: true, justTripped: false, count: w.count };
}

/** 供 /health 之类的诊断端点查看当前熔断状态（谁被限流了）。 */
export function listTrippedCircuitBreakers() {
  const now = Date.now();
  const out = [];
  for (const [key, w] of _windows) {
    if (w.tripped) out.push({ key, count: w.count, windowAgeMs: now - w.windowStart });
  }
  return out;
}
