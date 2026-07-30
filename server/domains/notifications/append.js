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
      const type = String(n?.type || 'system_notice').trim();
      const message = String(n?.message || '').trim();
      // 2026-07-30：这里是所有通知类型（排班/培训/离职/积分申请等）共用的唯一落库入口，
      // 之前完全没有去重检查——一旦上层调用方因为并发重复请求/竞态条件被多次触发（如
      // 日报提交接口被短时间内重复POST，命中"未提交"判断的多个并发请求各自都会走一遍
      // 通知全员的逻辑），这里就会无脑各插一遍，实测曾在同一秒内堆积出十几万条重复通知，
      // 拖垮数据库进而拖垮整机。加一道10分钟内同用户+同类型+同文案的去重锁，在唯一
      // 写入点堵住，不需要逐个上层调用方各自补防重复逻辑。
      const dup = await pool.query(
        `SELECT 1 FROM hrms_user_notifications
          WHERE lower(target_username) = lower($1) AND type = $2 AND message = $3
            AND read_at IS NULL AND created_at > NOW() - INTERVAL '10 minutes'
          LIMIT 1`,
        [target, type, message]
      );
      if (dup.rows.length) continue;
      await pool.query(
        `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, created_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          target,
          String(n?.title || '').trim() || '通知',
          message,
          type,
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
