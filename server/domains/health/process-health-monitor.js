/* cd-canary: tar-bundle deploy 2026-07-27 */
/**
 * 进程健康监视：启动时扫 PM2 日志找「非 SIGINT」异常退出；运行中盯内存压线。
 */
import fs from 'fs';
import v8 from 'v8';
import { logger } from '../../utils/logger.js';
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
    logger.error({ err: e, msg: 'process_health_pm2_log_read_failed' });
    return { ok: false, error: String(e?.message || e) };
  }

  const unexpected = scanPm2LogForUnexpectedExits(logText, { processName, afterMs });
  if (!unexpected.length) {
    logger.info({ msg: 'process_health_boot_ok', process: processName, unexpected_exits: 0 });
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

  logger.error({
    msg: 'process_health_unexpected_exits',
    process: processName,
    count: unexpected.length,
    preview: unexpected.slice(-5).map((e) => ({ signal: e.signal, code: e.code })),
  });
  if (typeof opts.notifyFn === 'function') {
    try {
      await opts.notifyFn(msg);
    } catch (e) {
      logger.error({ err: e, msg: 'process_health_notify_failed' });
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
  // 2026-08-04：只报 RSS 不够定位问题——RSS 高既可能是「真需要这么多」，也可能是
  // 「V8 攒着垃圾还没回收」，两者处置完全相反（前者要加内存，后者要调低 --max-old-space-size
  // 让 V8 提前做彻底 GC）。补上堆用量/堆上限，才能区分。
  const mu = process.memoryUsage();
  const mb = (n) => Math.round(n / 1048576);
  logger.warn({
    msg: 'process_health_memory_pressure',
    process: processName,
    rss_mb: pressure.rssMb,
    limit_mb: pressure.limitMb,
    ratio: pressure.ratio,
    heap_used_mb: mb(mu.heapUsed),
    heap_total_mb: mb(mu.heapTotal),
    external_mb: mb(mu.external),
    heap_limit_mb: mb(v8.getHeapStatistics().heap_size_limit),
  });
  if (typeof opts.notifyFn === 'function') {
    try {
      await opts.notifyFn(msg);
    } catch (e) {
      logger.error({ err: e, msg: 'process_health_memory_notify_failed' });
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
      logger.error({ err: e, msg: 'process_health_boot_check_error' });
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
      logger.error({ err: e, msg: 'process_health_memory_check_error' });
    });
  }, memIntervalMs);

  logger.info({
    msg: 'process_health_monitor_armed',
    boot_delay_ms: bootDelayMs,
    mem_interval_ms: memIntervalMs,
  });
}
