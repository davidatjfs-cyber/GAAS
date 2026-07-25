/**
 * 健康中心运营闭环定时：
 * - CST 08:30–08:44 队列摘要（客服 / 研发分流两条）
 * - 每日 SLA 提醒（超 24 小时未确认，不自动升级）
 */
import {
  buildQueueDigests,
  sendQueueDigests,
  sendSlaReminders,
} from './tenant-health-incident-service.js';
import { shanghaiParts } from './tenant-health-center-scheduler.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'tenant-health', handler: 'ops-scheduler' });

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   intervalMs?: number,
 *   digestHour?: number,
 *   digestMinuteEnd?: number,
 *   armed?: boolean,
 * }} [opts]
 */
export function startHealthOpsLoopScheduler(pool, opts = {}) {
  const intervalMs = opts.intervalMs ?? 60 * 1000;
  const digestHour = opts.digestHour ?? 8;
  const digestMinuteEnd = opts.digestMinuteEnd ?? 44;
  let lastDigestYmd = '';
  let lastSlaYmd = '';
  let runningDigest = false;
  let runningSla = false;

  const runDigest = async () => {
    if (runningDigest) return;
    const { ymd, hour, minute } = shanghaiParts();
    if (hour !== digestHour || minute < 30 || minute > digestMinuteEnd) return;
    if (lastDigestYmd === ymd) return;
    runningDigest = true;
    lastDigestYmd = ymd;
    try {
      const sent = await sendQueueDigests(pool);
      log.info({ msg: 'digest_sent', cs: sent.digests?.cs?.count ?? 0, eng: sent.digests?.eng?.count ?? 0 });
    } catch (e) {
      log.error({ msg: 'digest_failed', err: e?.message || String(e) });
      lastDigestYmd = '';
    } finally {
      runningDigest = false;
    }
  };

  const runSla = async () => {
    if (runningSla) return;
    const { ymd, hour } = shanghaiParts();
    if (hour < 9 || hour > 20) return;
    if (lastSlaYmd === ymd) return;
    runningSla = true;
    lastSlaYmd = ymd;
    try {
      const r = await sendSlaReminders(pool);
      if (r.count > 0) log.info({ msg: 'sla_reminder', count: r.count, sent: r.sent });
    } catch (e) {
      log.error({ msg: 'sla_reminder_failed', err: e?.message || String(e) });
      lastSlaYmd = '';
    } finally {
      runningSla = false;
    }
  };

  const tick = async () => {
    await runDigest();
    await runSla();
  };

  if (opts.armed === false) {
    return { tick, runDigest, runSla, shanghaiParts, buildQueueDigests };
  }

  setTimeout(() => { tick().catch(() => {}); }, 180 * 1000);
  setInterval(() => { tick().catch(() => {}); }, intervalMs);
  log.info({ msg: 'health_ops_loop_armed', digest_hour: digestHour, digest_minute_end: digestMinuteEnd });
  return { tick, runDigest, runSla, shanghaiParts };
}
