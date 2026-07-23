/**
 * 通知域：hrms_user_notifications 为权威，hrms_state.notifications 仅为镜像。
 * GET /api/state 通过 hydrateNotificationsFromTable 覆盖。
 */

import { SHARED_TABLES } from '@gaas/shared';

const TABLE = SHARED_TABLES.HRMS_USER_NOTIFICATIONS;

export function notificationRowToStateShape(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    targetUser: String(row.target_username || '').trim(),
    title: String(row.title || '').trim(),
    message: String(row.message || '').trim(),
    type: String(row.type || 'system_notice').trim(),
    meta: row.meta && typeof row.meta === 'object' ? row.meta : {},
    createdAt: row.created_at ? String(row.created_at) : '',
  };
}

export async function loadNotificationsFromTable(pool, tenantId, limit = 500) {
  const tid = String(tenantId || 'default');
  const lim = Math.min(1000, Math.max(1, Number(limit) || 500));
  let r;
  try {
    r = await pool.query(
      `SELECT id, target_username, title, message, type, meta, created_at
         FROM ${TABLE}
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [tid, lim]
    );
  } catch (e) {
    // 兼容旧库无 tenant_id 列
    if (!/tenant_id|column/i.test(String(e?.message || ''))) throw e;
    r = await pool.query(
      `SELECT id, target_username, title, message, type, meta, created_at
         FROM ${TABLE}
        ORDER BY created_at DESC
        LIMIT $1`,
      [lim]
    );
  }
  return (r.rows || []).map(notificationRowToStateShape).filter((n) => n?.id);
}

/**
 * 表有数据时覆盖 state.notifications；并保留仅存在于 state 的孤立项（过渡期）。
 */
export async function hydrateNotificationsFromTable(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  try {
    const fromTable = await loadNotificationsFromTable(pool, tenantId);
    if (!fromTable.length) return base;
    const existing = Array.isArray(base.notifications) ? base.notifications : [];
    const dbIds = new Set(fromTable.map((n) => n.id));
    const stateOnly = existing.filter((n) => n?.id && !dbIds.has(String(n.id)));
    base.notifications = [...fromTable, ...stateOnly];
  } catch (e) {
    console.error('[notifications-domain] hydrate failed:', e?.message || e);
  }
  return base;
}
