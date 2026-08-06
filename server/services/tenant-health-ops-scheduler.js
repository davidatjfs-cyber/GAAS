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
import { beatHeartbeatSimple } from '../domains/health/monitor-beat.js';

const log = childLogger({ domain: 'tenant-health', handler: 'ops-scheduler' });

// 2026-08-01 修复：runDigest/runSla 的"今天发过了"去重之前只存在进程内存变量(lastDigestYmd/
// lastSlaYmd)里——(1) 每次 pm2 restart 这个变量都会清零，(2) catch 块里还会在失败时主动清零
// 这个变量，"重试"，等于自己废掉了自己的去重。今天连续多次 restart(修复其它bug)期间，这个
// SLA 提醒被反复重置、反复重发，用户看到的"每隔几十分钟就来一遍一模一样的SLA提醒"就是这个
// 设计缺陷，跟今天其它几个bug是同一类"进程内状态没有持久化"的问题。改成读写数据库持久化的
// "今天是否已发送"标记，重启/偶发失败都不会清空这个标记，只有真正跨自然日才会重新允许发送。
async function hasSentTodayPersisted(pool, taskName, ymd) {
  try {
    const r = await pool.query(`SELECT last_beat FROM scheduler_heartbeat WHERE task_name = $1`, [taskName]);
    const lastBeat = r.rows?.[0]?.last_beat;
    if (!lastBeat) return false;
    const lastYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(lastBeat));
    return lastYmd === ymd;
  } catch (e) {
    log.warn({ msg: 'hasSentTodayPersisted_check_failed', taskName, err: e?.message });
    return false;
  }
}

// 2026-08-06：原先这里内联了一份自己的 UPSERT，只写 last_beat/run_count。migration 180 给
// scheduler_heartbeat 加了 last_success_at 之后，这种绕过 beatHeartbeatSimple 的写法会让
// last_beat 一直更新、last_success_at 永远停在回填时刻 —— 监控据此判定「在跑但一直没成功」，
// 本文件的两个任务上线当天就被误报 failing。心跳只允许有一个写入方。
async function markSentTodayPersisted(pool, taskName) {
  await beatHeartbeatSimple(pool, taskName);
}

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
  let runningDigest = false;
  let runningSla = false;

  const runDigest = async () => {
    if (runningDigest) return;
    const { ymd, hour, minute } = shanghaiParts();
    if (hour !== digestHour || minute < 30 || minute > digestMinuteEnd) return;
    if (await hasSentTodayPersisted(pool, 'health_queue_digest_daily', ymd)) return;
    runningDigest = true;
    try {
      const sent = await sendQueueDigests(pool);
      await markSentTodayPersisted(pool, 'health_queue_digest_daily');
      log.info({ msg: 'digest_sent', cs: sent.digests?.cs?.count ?? 0, eng: sent.digests?.eng?.count ?? 0 });
    } catch (e) {
      log.error({ msg: 'digest_failed', err: e?.message || String(e) });
    } finally {
      runningDigest = false;
    }
  };

  const runSla = async () => {
    if (runningSla) return;
    const { ymd, hour } = shanghaiParts();
    if (hour < 9 || hour > 20) return;
    if (await hasSentTodayPersisted(pool, 'health_sla_reminder_daily', ymd)) return;
    runningSla = true;
    try {
      const r = await sendSlaReminders(pool);
      await markSentTodayPersisted(pool, 'health_sla_reminder_daily');
      if (r.count > 0) log.info({ msg: 'sla_reminder', count: r.count, sent: r.sent });
    } catch (e) {
      log.error({ msg: 'sla_reminder_failed', err: e?.message || String(e) });
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
