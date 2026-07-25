/**
 * 解析 PM2 god log 退出行，区分「部署/手工 stop」与「异常退出」。
 *
 * 典型行：
 *   App [hrms-service:1102] exited with code [0] via signal [SIGINT]
 */

const EXIT_RE =
  /App \[([^:\]]+)(?::\d+)?\] exited with code \[(\d+)\] via signal \[([^\]]+)\]/;

/**
 * @param {string} line
 * @returns {{ processName: string, code: number, signal: string, intentional: boolean, kind: string }|null}
 */
export function parsePm2ExitEvent(line) {
  const m = String(line || '').match(EXIT_RE);
  if (!m) return null;
  const processName = m[1];
  const code = Number(m[2]);
  const signal = String(m[3] || '');
  const intentional = code === 0 && signal === 'SIGINT';
  return {
    processName,
    code,
    signal,
    intentional,
    kind: intentional ? 'deploy_or_manual_stop' : 'unexpected_exit',
  };
}

/**
 * @param {string[]} lines
 * @param {{ processName?: string }} [opts]
 */
export function collectUnexpectedPm2Exits(lines, opts = {}) {
  const want = opts.processName ? String(opts.processName) : '';
  const out = [];
  for (const line of lines || []) {
    const ev = parsePm2ExitEvent(line);
    if (!ev || ev.intentional) continue;
    if (want && ev.processName !== want) continue;
    out.push({ ...ev, raw: String(line).trim() });
  }
  return out;
}

/**
 * 从带时间戳的 pm2.log 行提取毫秒时间（失败则 null）。
 * 例：2026-07-25T12:17:51: PM2 log: ...
 */
export function parsePm2LogTimestampMs(line) {
  const m = String(line || '').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (!m) return null;
  const ms = Date.parse(m[1]);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {string} logText
 * @param {{ processName: string, afterMs?: number }} opts
 */
export function scanPm2LogForUnexpectedExits(logText, opts) {
  const lines = String(logText || '').split('\n');
  const afterMs = Number(opts.afterMs || 0);
  const unexpected = [];
  for (const line of lines) {
    const ev = parsePm2ExitEvent(line);
    if (!ev || ev.intentional) continue;
    if (ev.processName !== opts.processName) continue;
    const ts = parsePm2LogTimestampMs(line);
    if (afterMs && ts != null && ts <= afterMs) continue;
    unexpected.push({ ...ev, ts, raw: line.trim() });
  }
  return unexpected;
}

/**
 * @param {{ rssBytes: number, maxMemoryRestartBytes: number, warnRatio?: number }} opts
 * @returns {{ ok: true } | { ok: false, ratio: number, rssMb: number, limitMb: number }}
 */
export function evaluateMemoryPressure(opts) {
  const rss = Number(opts.rssBytes || 0);
  const limit = Number(opts.maxMemoryRestartBytes || 0);
  const warnRatio = Number(opts.warnRatio ?? 0.85);
  if (!limit || limit <= 0 || !rss) return { ok: true };
  const ratio = rss / limit;
  if (ratio < warnRatio) return { ok: true };
  return {
    ok: false,
    ratio: Number(ratio.toFixed(3)),
    rssMb: Math.round(rss / 1024 / 1024),
    limitMb: Math.round(limit / 1024 / 1024),
  };
}
