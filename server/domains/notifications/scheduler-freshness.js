/**
 * Data freshness monitor cron (every 6h, first run deferred 90s).
 * Wave H13 peel from index.js.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'notifications', handler: 'freshness' });

// 2026-08-02：用户反馈"数据新鲜度告警"每隔几十分钟就重复来一次——查证根因是"今天是否
// 已告警"的去重只存在进程内存变量(_freshnessAlertFiredDate)里，pm2 restart会清零这个
// 变量；服务在短时间内重启(部署其它修复)期间，每次重启后90秒的"首次tick"都会在去重被
// 清零的情况下重新判定"今天还没告警过"，于是反复重发。跟2026-08-01
// tenant-health-ops-scheduler.js修过的SLA提醒重复bug是同一类"进程内状态没有持久化"
// 问题，当时漏改了这个文件。改成读写scheduler_heartbeat持久化"今天是否已发送"标记，
// 重启不会清空，只有真正跨自然日才会重新允许发送。
async function hasSentTodayPersisted(pool, taskName, ymd) {
  try {
    const r = await pool.query(`SELECT last_beat FROM scheduler_heartbeat WHERE task_name = $1`, [taskName]);
    const lastBeat = r.rows?.[0]?.last_beat;
    if (!lastBeat) return false;
    const lastYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(lastBeat));
    return lastYmd === ymd;
  } catch (_e) {
    return false;
  }
}

async function markSentTodayPersisted(pool, taskName) {
  try {
    await pool.query(
      `INSERT INTO scheduler_heartbeat (task_name, last_beat, run_count, tenant_id)
       VALUES ($1, NOW(), 1, 'default')
       ON CONFLICT (task_name)
       DO UPDATE SET last_beat = NOW(), run_count = scheduler_heartbeat.run_count + 1`,
      [taskName]
    );
  } catch (_e) {
    /* ignore */
  }
}

export function createFreshnessMonitorScheduler({
  pool,
  runForActiveTenants,
  runFreshnessCheck,
  FRESHNESS_SOURCES,
  sendLarkMessage,
}) {
  // 数据新鲜度监控：server/ontology/freshness.js写好后一直没接cron，是纯代码骨架，
  // 这里激活它——每6小时按活跃租户检查一遍，每个租户每天最多告警一次(防止刷屏)。

  async function runFreshnessMonitorTick() {
    try {
      await runForActiveTenants(async (tenantId) => {
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
        const taskName = `freshness_alert_${tenantId}`;
        if (await hasSentTodayPersisted(pool, taskName, todayStr)) return;
        const { stale, alertText } = await runFreshnessCheck(pool, FRESHNESS_SOURCES);
        if (!alertText) return;
        await markSentTodayPersisted(pool, taskName);
        const r = await pool.query(
          `SELECT DISTINCT open_id
         FROM feishu_users
         WHERE registered = true
           AND open_id IS NOT NULL
           AND open_id NOT LIKE '%probe%'
           AND (
             TRIM(LOWER(role)) IN ('admin', 'hq_manager')
             OR TRIM(role) IN ('管理员', '系统管理员', '总部经理', '总部营运')
           )
         LIMIT 35`
        );
        const rows = r.rows || [];
        if (!rows.length) {
          log.error({
            msg: 'freshness_no_feishu_recipients',
            tenant_id: tenantId,
            stale: (stale || []).map((s) => s.name),
          });
          return;
        }
        const sends = rows.map((row) =>
          sendLarkMessage(row.open_id, alertText, { skipDedup: true }).catch((e) => ({ err: e?.message || e }))
        );
        const settled = await Promise.all(sends);
        const failed = settled.filter((x) => x && x.err);
        if (failed.length) {
          log.error({
            msg: 'freshness_feishu_partial_fail',
            tenant_id: tenantId,
            failed: failed.length,
            total: settled.length,
            err: failed[0]?.err || null,
          });
        } else {
          log.info({
            msg: 'freshness_alert_sent',
            tenant_id: tenantId,
            stale: (stale || []).map((s) => s.name),
          });
        }
      }, { continueOnError: true });
    } catch (e) {
      log.error({ msg: 'freshness_run_failed', err: e?.message || String(e) });
    }
  }

  let started = false;
  function startFreshnessMonitorScheduler() {
    if (started) return;
    started = true;
    setTimeout(() => {
      runFreshnessMonitorTick();
    }, 90000);
    setInterval(runFreshnessMonitorTick, 6 * 3600 * 1000);
  }

  return { runFreshnessMonitorTick, startFreshnessMonitorScheduler };
}
