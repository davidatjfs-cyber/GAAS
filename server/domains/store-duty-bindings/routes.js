import { ensureReady, listBindings, upsertBinding, deleteBinding } from './service.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: any }} deps
 */
export function registerStoreDutyBindingsRoutes(app, authRequired, deps) {
  const { pool } = deps;

  app.get('/api/admin/store-duty-bindings', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    try {
      await ensureReady(pool);
      const items = await listBindings(pool);
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/admin/store-duty-bindings', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    try {
      await ensureReady(pool);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const username = String(body.username || '').trim();
      const store = String(body.store || '').trim();
      if (!username || !store) return res.status(400).json({ error: 'missing_username_or_store' });
      const tenantId = req.tenantId || req.user?.tenant_id || 'default';
      const item = await upsertBinding(pool, body, tenantId);
      return res.json({ item });
    } catch (e) {
      if (e?.code === 'missing_username_or_store') {
        return res.status(400).json({ error: 'missing_username_or_store' });
      }
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.delete('/api/admin/store-duty-bindings/:id', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    try {
      await ensureReady(pool);
      const id = Number(req.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'invalid_id' });
      const deleted = await deleteBinding(pool, id);
      if (!deleted) return res.status(404).json({ error: 'not_found' });
      return res.json({ ok: true });
    } catch (e) {
      if (e?.code === 'invalid_id') return res.status(400).json({ error: 'invalid_id' });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
