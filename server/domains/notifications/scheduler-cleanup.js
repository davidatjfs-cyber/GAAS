/**
 * Notification cleanup cron (every 6h, first run deferred 1 min).
 * Wave H13 peel from index.js.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'notifications', handler: 'cleanup' });

export function createNotificationsCleanupScheduler({ pool, runForActiveTenants }) {
  // ── Scheduled cleanup: retain 2 months of notifications ────
  // hrms_user_notifications带RLS，原只清default租户；改为遍历活跃租户各自清理
  async function cleanupOldNotifications() {
    let deleted = 0;
    try {
      await runForActiveTenants(async () => {
        const r = await pool.query(`DELETE FROM hrms_user_notifications WHERE created_at < now() - interval '3 days' AND id NOT IN (SELECT id FROM hrms_user_notifications ORDER BY created_at DESC LIMIT 50)`);
        deleted += r.rowCount ?? 0;
      }, { continueOnError: true });
    } catch (e) {
      log.error({ msg: 'notifications_cleanup_failed', err: e?.message });
    }
    if (deleted > 0) log.info({ msg: 'notifications_cleanup_deleted', deleted });
  }

  let started = false;
  function startNotificationsCleanupScheduler() {
    if (started) return;
    started = true;
    // Run every 6 hours; first run deferred 1 min after startup
    setTimeout(() => {
      cleanupOldNotifications();
    }, 60000);
    setInterval(cleanupOldNotifications, 6 * 3600 * 1000);
  }

  return { cleanupOldNotifications, startNotificationsCleanupScheduler };
}
