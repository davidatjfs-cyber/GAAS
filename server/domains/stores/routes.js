import express from 'express';
import { removeStoreFromList } from './service.js';
import { patchHrmsStateFieldsOnClient, readHrmsStateForUpdate, withMirrorWriteTx } from '../shared/mirror-tx.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'stores', handler: 'routes' });


/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: any,
 *   resolveTenantId: (req)=>string,
 * }} deps
 */
export function registerStoresDomainRoutes(app, authRequired, deps) {
  const { pool, resolveTenantId } = deps;
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
      const removed = await withMirrorWriteTx(pool, async (client) => {
        const { current } = await readHrmsStateForUpdate(client, tid);
        const result = removeStoreFromList(current.stores, id);
        if (!result.ok) {
          const err = new Error('not_found');
          err.code = 'not_found';
          throw err;
        }
        await patchHrmsStateFieldsOnClient(client, tid, { stores: result.stores });
        return result.removed;
      });
      return res.json({ ok: true, removed });
    } catch (e) {
      if (e?.code === 'not_found') return res.status(404).json({ error: 'not_found' });
      log.error({ msg: 'delete_api_stores_id', err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.use('/api/stores', r);
}

export { registerStoresCrudRoutes } from './routes-crud.js';
export { registerBrandsRoutes } from './routes-brands.js';
