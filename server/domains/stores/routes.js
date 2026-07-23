import express from 'express';
import { removeStoreFromList } from './service.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   getSharedState: (tenantId?: string)=>Promise<object|null>,
 *   saveSharedState: (data: object, tenantId?: string)=>Promise<any>,
 *   resolveTenantId: (req)=>string,
 * }} deps
 */
export function registerStoresDomainRoutes(app, authRequired, deps) {
  const { getSharedState, saveSharedState, resolveTenantId } = deps;
  const r = express.Router();

  r.delete('/:id', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'forbidden', message: '仅管理员可删除门店' });
    }
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const tid = resolveTenantId(req);
      const state0 = (await getSharedState(tid)) || {};
      const result = removeStoreFromList(state0.stores, id);
      if (!result.ok) return res.status(404).json({ error: 'not_found' });
      await saveSharedState({ ...state0, stores: result.stores }, tid);
      return res.json({ ok: true, removed: result.removed });
    } catch (e) {
      console.error('[DELETE /api/stores/:id]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.use('/api/stores', r);
}
