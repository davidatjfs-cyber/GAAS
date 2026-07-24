/**
 * Notification cleanup cron (every 6h, first run deferred 1 min).
 * Wave H13 peel from index.js.
 */
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
      console.error('[cleanup] hrms_user_notifications error:', e?.message);
    }
    if (deleted > 0) console.log('[cleanup] hrms_user_notifications deleted:', deleted);
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
