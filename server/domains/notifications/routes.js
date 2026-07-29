/**
 * DELETE /api/notifications/:id, POST /api/notifications/batch
 * (behavior-preserving extract from index.js ~12473–12515).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'notifications', handler: 'routes' });

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: import('pg').Pool,
 *   resolveTenantIdDefault: ()=>string,
 * }} deps
 */
export function registerNotificationsWriteRoutes(app, authRequired, deps) {
  const { pool, resolveTenantIdDefault } = deps;

  // 2026-07-29 新增：之前只有未读数(getUnreadInboxCount)，没有"列表"接口——工作台"通知"tab
  // 一直只能显示数字、点了看不到内容。hrms_user_notifications 是权威表(service.js里的注释)，
  // 不是从 hrms_state.notifications 镜像读，直接查真实表。
  app.get('/api/notifications', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit) || 30));
    try {
      const r = await pool.query(
        `SELECT id, title, message, type, meta, created_at, read_at
           FROM hrms_user_notifications
          WHERE tenant_id = $1 AND target_username = $2
          ORDER BY created_at DESC LIMIT $3`,
        [tenantId, username, limit]
      );
      res.json({ ok: true, items: r.rows || [] });
    } catch (e) {
      log.error({ msg: 'notifications_list_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/notifications/:id/read', authRequired, async (req, res) => {
    const tenantId = resolveTenantIdDefault(req.tenantId);
    const username = String(req.user?.username || '').trim();
    const notifId = String(req.params.id || '').trim();
    if (!notifId) return res.status(400).json({ error: 'missing_id' });
    try {
      await pool.query(
        `UPDATE hrms_user_notifications SET read_at = NOW()
          WHERE id = $1 AND tenant_id = $2 AND target_username = $3 AND read_at IS NULL`,
        [notifId, tenantId, username]
      );
      res.json({ ok: true });
    } catch (e) {
      log.error({ msg: 'notifications_mark_read_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'server_error' });
    }
  });

  app.delete('/api/notifications/:id', authRequired, async (req, res) => {
    if (String(req.user?.role || '') !== 'admin') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const notifId = String(req.params.id || '').trim();
    if (!notifId) return res.status(400).json({ error: 'missing_id' });
    try {
      const r = await pool.query(`DELETE FROM hrms_user_notifications WHERE id = $1`, [notifId]);
      if (r.rowCount === 0) {
        return res.json({ ok: true, deleted: 0, note: 'not_in_db' });
      }
      res.json({ ok: true, deleted: r.rowCount });
    } catch (e) {
      log.error({ msg: 'notifications_delete_failed', request_id: req.requestId, err: e?.message });
      res.status(500).json({ error: 'db_error' });
    }
  });

  app.post('/api/notifications/batch', authRequired, async (req, res) => {
    const items = Array.isArray(req.body?.notifications) ? req.body.notifications : [];
    if (!items.length) return res.status(400).json({ error: 'empty' });
    try {
      const ids = [];
      for (const n of items) {
        const target = String(n.targetUser || '').trim();
        const title  = String(n.title   || '').trim();
        const msg    = String(n.message || '').trim();
        const type   = String(n.type    || 'system').trim();
        const meta   = (n.meta && typeof n.meta === 'object') ? n.meta : {};
        if (!target || !title) continue;
        const r = await pool.query(
          `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [target, title, msg, type, meta, resolveTenantIdDefault()]
        );
        ids.push(r.rows[0]?.id);
      }
      return res.json({ ok: true, ids });
    } catch (e) {
      log.error({ msg: 'notifications_batch_failed', request_id: req.requestId, err: e?.message });
      return res.status(500).json({ error: 'server_error' });
    }
  });
}
