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
      log.error({ msg: 'notifications_delete_failed', err: e?.message });
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
      log.error({ msg: 'notifications_batch_failed', err: e?.message });
      return res.status(500).json({ error: 'server_error' });
    }
  });
}
