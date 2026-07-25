/**
 * 健康中心每日全量扫描：CST 07:00–07:14 窗口内跑一次，保证客服上班前红名单就绪。
 */
import { scanHealthCenter } from './tenant-health-center-service.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'tenant-health', handler: 'center-scheduler' });

export function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const hour = Number(get('hour') === '24' ? '0' : get('hour'));
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    hour,
    minute: Number(get('minute')),
  };
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ intervalMs?: number, windowHour?: number, windowMinuteEnd?: number, armed?: boolean }} [opts]
 */
export function startHealthCenterDailyScanScheduler(pool, opts = {}) {
  const intervalMs = opts.intervalMs ?? 60 * 1000;
  const windowHour = opts.windowHour ?? 7;
  const windowMinuteEnd = opts.windowMinuteEnd ?? 14;
  let lastScanYmd = '';
  let running = false;

  const tick = async () => {
    if (running) return;
    const { ymd, hour, minute } = shanghaiParts();
    if (hour !== windowHour || minute > windowMinuteEnd) return;
    if (lastScanYmd === ymd) return;
    running = true;
    lastScanYmd = ymd;
    try {
      log.info({ msg: 'daily_scan_start', date: ymd });
      const result = await scanHealthCenter(pool, { date: ymd });
      log.info({ msg: 'daily_scan_done', scanned: result.scanned, success: result.success, failed: result.failed });
      try {
        const { syncIncidentsFromInspections } = await import('./tenant-health-incident-service.js');
        const synced = await syncIncidentsFromInspections(pool, {});
        log.info({ msg: 'incidents_sync_done', upserted: synced?.upserted ?? 0 });
      } catch (e) {
        log.error({ msg: 'incidents_sync_failed', err: e?.message || String(e) });
      }
    } catch (e) {
      log.error({ msg: 'daily_scan_failed', err: e?.message || String(e) });
      lastScanYmd = '';
    } finally {
      running = false;
    }
  };

  if (opts.armed === false) {
    return { tick, shanghaiParts };
  }

  setTimeout(() => { tick().catch(() => {}); }, 120 * 1000);
  setInterval(() => { tick().catch(() => {}); }, intervalMs);
  log.info({ msg: 'daily_scan_scheduler_armed', window_hour: windowHour, window_minute_end: windowMinuteEnd });
  return { tick, shanghaiParts };
}
