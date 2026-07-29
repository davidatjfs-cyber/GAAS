/**
 * appendNotifications / insertHrmsUserNotifications
 * (behavior-preserving extract from index.js)
 *
 * appendNotifications 只写 hrms_user_notifications 表（权威），不再 merge blob。
 */

export function createAppendHelpers({
  pool,
  resolveTenantIdDefault,
  hrmsNowISO,
  invalidateSharedStateCache,
}) {
  async function insertHrmsUserNotifications(notifs) {
    const list = Array.isArray(notifs) ? notifs.filter(Boolean) : [];
    if (!list.length) return;
    const tid = resolveTenantIdDefault();
    for (const n of list) {
      const target = String(n?.targetUser || n?.targetUsername || n?.to || '').trim();
      if (!target) continue;
      await pool.query(
        `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, created_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          target,
          String(n?.title || '').trim() || '通知',
          String(n?.message || '').trim(),
          String(n?.type || 'system_notice').trim(),
          JSON.stringify(n?.meta || n?.data || {}),
          n?.createdAt ? new Date(n.createdAt).toISOString() : hrmsNowISO(),
          tid,
        ]
      );
    }
    if (typeof invalidateSharedStateCache === 'function') {
      invalidateSharedStateCache(tid);
    }
  }

  async function appendNotifications(notifs) {
    await insertHrmsUserNotifications(notifs);
  }

  return { appendNotifications, insertHrmsUserNotifications };
}
