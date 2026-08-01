/**
 * Heartbeat + system alert helpers — P5.4.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'health', handler: 'startup-monitors' });

export async function beatHeartbeat(deps, taskName) {
  const { pool, tenantContext } = deps;
  try {
    await tenantContext.run('default', async () => {
      await pool.query(
        `INSERT INTO scheduler_heartbeat (task_name, last_beat, run_count, tenant_id)
         VALUES ($1, NOW(), 1, 'default')
         ON CONFLICT (task_name)
         DO UPDATE SET last_beat = NOW(), run_count = scheduler_heartbeat.run_count + 1`,
        [taskName]
      );
    });
  } catch (_) {
    /* ignore */
  }
}

/**
 * 2026-08-01：pool-only 版心跳，给那些只拿到 pool、没有整条 deps 依赖链的定时任务文件用
 * （系统性排查发现 32 个 setInterval/cron.schedule 文件里心跳覆盖率是 0，大部分文件只
 * import 了 pool，重新给每个文件都插一条 tenantContext 依赖链条不划算）。跟
 * beatHeartbeat 写同一张 scheduler_heartbeat 表，tenant_id 固定 'default'——这些后台
 * 循环本身也不区分租户。
 */
export async function beatHeartbeatSimple(pool, taskName) {
  try {
    await pool.query(
      `INSERT INTO scheduler_heartbeat (task_name, last_beat, run_count, tenant_id)
       VALUES ($1, NOW(), 1, 'default')
       ON CONFLICT (task_name)
       DO UPDATE SET last_beat = NOW(), run_count = scheduler_heartbeat.run_count + 1`,
      [taskName]
    );
  } catch (_) {
    /* ignore */
  }
}

/**
 * 2026-08-01：多个 monitor（sales-check每日一次去重、心跳异常告警2小时冷却）之前都是
 * 各自维护一个进程内 Map/变量做"今天/这段时间是否已触发过"的去重——pm2 restart 就清零，
 * 生产实测因为一天内多次重启，同一条告警在同一个日期窗口内被重复插入了几十条（比如
 * "销售数据缺失告警"同一秒内插入4条完全相同的记录），用户被迫反复点掉"同一条"通知。
 * 复用 scheduler_heartbeat 表做持久化去重，语义是"这个 key 距上次触发是否已经过了
 * cooldownMinutes"，重启不再清零这个判断依据。
 */
export async function wasRecentlyFiredPersisted(pool, key, cooldownMinutes) {
  try {
    const r = await pool.query(`SELECT last_beat FROM scheduler_heartbeat WHERE task_name = $1`, [key]);
    const lastBeat = r.rows?.[0]?.last_beat;
    if (!lastBeat) return false;
    const ageMin = (Date.now() - new Date(lastBeat).getTime()) / 60000;
    return ageMin < cooldownMinutes;
  } catch (_) {
    return false;
  }
}

export async function markFiredPersisted(pool, key) {
  await beatHeartbeatSimple(pool, key);
}

export async function sendSystemAlert(deps, msg) {
  const { sendAdminSystemAlert } = deps;
  try {
    await sendAdminSystemAlert(msg, {
      persistToHrms: true,
      notificationType: 'system_alert',
      meta: { source: 'monitor' },
    });
  } catch (e) {
    log.error({
      msg: 'monitor',
      detail: ['[monitor] sendSystemAlert error:', e?.message]
        .map((x) => (x == null ? '' : String(x)))
        .join(' '),
    });
  }
}
