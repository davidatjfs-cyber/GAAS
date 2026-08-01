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
