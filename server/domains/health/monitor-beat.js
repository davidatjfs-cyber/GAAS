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
