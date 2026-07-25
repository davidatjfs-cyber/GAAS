/**
 * 进程健康监视：启动时扫 PM2 日志找「非 SIGINT」异常退出；运行中盯内存压线。
 */
import fs from 'fs';
import {
  evaluateMemoryPressure,
  scanPm2LogForUnexpectedExits,
} from './pm2-exit-classify.js';

const DEFAULT_PM2_LOG = '/root/.pm2/pm2.log';
const DEFAULT_PROCESS = 'hrms-service';

/**
 * @param {{
 *   notifyFn: (msg: string) => Promise<unknown>,
 *   processName?: string,
 *   pm2LogPath?: string,
 *   lookbackMs?: number,
 *   maxMemoryRestartBytes?: number,
 *   getRssBytes?: () => number,
 *   nowMs?: () => number,
 * }} opts
 */
export async function runProcessHealthBootCheck(opts) {
  const processName = opts.processName || DEFAULT_PROCESS;
  const pm2LogPath = opts.pm2LogPath || process.env.PM2_LOG_PATH || DEFAULT_PM2_LOG;
  const lookbackMs = Number(opts.lookbackMs || 30 * 60 * 1000);
  const now = typeof opts.nowMs === 'function' ? opts.nowMs() : Date.now();
  const afterMs = now - lookbackMs;

  let logText = '';
  try {
    if (!fs.existsSync(pm2LogPath)) {
      return { skipped: true, reason: 'pm2_log_missing' };
    }
    const st = fs.statSync(pm2LogPath);
    const start = Math.max(0, st.size - 512 * 1024);
    const fd = fs.openSync(pm2LogPath, 'r');
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      logText = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    console.error('[process-health] read pm2 log failed:', e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }

  const unexpected = scanPm2LogForUnexpectedExits(logText, { processName, afterMs });
  if (!unexpected.length) {
    console.log(`[process-health] boot ok process=${processName} unexpected_exits=0`);
    return { ok: true, unexpected: [] };
  }

  const preview = unexpected
    .slice(-5)
    .map((e) => `${e.signal || '?'} code=${e.code} ${e.raw?.slice(0, 120) || ''}`)
    .join('\n');
  const msg = [
    `🚨【${processName} 异常退出】`,
    `近 ${Math.round(lookbackMs / 60000)} 分钟内检测到 ${unexpected.length} 次非 SIGINT 退出（部署/手工 restart 是 SIGINT，不会进此告警）。`,
    preview,
    '请查 pm2.log / err 日志；若为 OOM 请看 max_memory_restart 与 RSS。',
  ].join('\n');

  console.error('[process-health]', msg.replace(/\n/g, ' | '));
  if (typeof opts.notifyFn === 'function') {
    try {
      await opts.notifyFn(msg);
    } catch (e) {
      console.error('[process-health] notify failed:', e?.message || e);
    }
  }
  return { ok: false, unexpected };
}

/**
 * @param {{
 *   notifyFn: (msg: string) => Promise<unknown>,
 *   processName?: string,
 *   maxMemoryRestartBytes?: number,
 *   getRssBytes?: () => number,
 *   warnRatio?: number,
 * }} opts
 */
export async function runMemoryPressureCheck(opts) {
  const processName = opts.processName || DEFAULT_PROCESS;
  const maxMemoryRestartBytes = Number(
    opts.maxMemoryRestartBytes || process.env.PM2_MAX_MEMORY_RESTART_BYTES || 0
  );
  const getRss =
    typeof opts.getRssBytes === 'function'
      ? opts.getRssBytes
      : () => process.memoryUsage().rss;
  const pressure = evaluateMemoryPressure({
    rssBytes: getRss(),
    maxMemoryRestartBytes,
    warnRatio: opts.warnRatio,
  });
  if (pressure.ok) return { ok: true, pressure };

  const msg = [
    `⚠️【${processName} 内存压线】`,
    `RSS≈${pressure.rssMb}MB / PM2 max_memory_restart=${pressure.limitMb}MB（${Math.round(pressure.ratio * 100)}%）`,
    '接近阈值后会被 PM2 杀掉重启；请排查泄漏或上调限额。',
  ].join('\n');
  console.error('[process-health]', msg.replace(/\n/g, ' | '));
  if (typeof opts.notifyFn === 'function') {
    try {
      await opts.notifyFn(msg);
    } catch (e) {
      console.error('[process-health] memory notify failed:', e?.message || e);
    }
  }
  return { ok: false, pressure };
}

/**
 * @param {{
 *   notifyFn: (msg: string) => Promise<unknown>,
 *   processName?: string,
 *   pm2LogPath?: string,
 *   maxMemoryRestartBytes?: number,
 * }} opts
 */
export function startProcessHealthMonitor(opts = {}) {
  const notifyFn = opts.notifyFn;
  const bootDelayMs = Number(process.env.PROCESS_HEALTH_BOOT_DELAY_MS || 45_000);
  const memIntervalMs = Number(process.env.PROCESS_HEALTH_MEM_INTERVAL_MS || 5 * 60_000);

  setTimeout(() => {
    runProcessHealthBootCheck({ ...opts, notifyFn }).catch((e) => {
      console.error('[process-health] boot check error:', e?.message || e);
    });
  }, bootDelayMs);

  let lastMemAlertAt = 0;
  const memCooldownMs = 60 * 60 * 1000;
  setInterval(() => {
    runMemoryPressureCheck({
      ...opts,
      notifyFn: async (msg) => {
        const now = Date.now();
        if (now - lastMemAlertAt < memCooldownMs) return;
        lastMemAlertAt = now;
        if (typeof notifyFn === 'function') await notifyFn(msg);
      },
    }).catch((e) => {
      console.error('[process-health] memory check error:', e?.message || e);
    });
  }, memIntervalMs);

  console.log(
    `[process-health] monitor armed boot_delay_ms=${bootDelayMs} mem_interval_ms=${memIntervalMs}`
  );
}
