import { childLogger } from '../../utils/logger.js';
import {
  mergeStateFieldsOnClient,
  patchHrmsStateFieldsOnClient,
  readHrmsStateForUpdate,
  withMirrorWriteTx,
} from '../shared/mirror-tx.js';
import {
  normalizeUserRecord,
  removeUserFromList,
  upsertUsersInList,
} from './service.js';
import { requireRemainingStateAdmin } from './routes-announcements.js';

const log = childLogger({ domain: 'remaining-state', handler: 'routes-hrms-users' });

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: any, getSharedState: Function, resolveTenantId: Function }} deps
 */
export function registerRemainingStateHrmsUserRoutes(app, authRequired, deps) {
  const { pool, getSharedState, resolveTenantId } = deps;

  app.get('/api/hrms-users', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state = (await getSharedState(tid)) || {};
      return res.json({ items: Array.isArray(state.users) ? state.users : [] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.put('/api/hrms-users/:username', authRequired, async (req, res) => {
    if (!requireRemainingStateAdmin(req, res)) return;
    const username = String(req.params?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    try {
      const tid = resolveTenantId(req);
      const user = normalizeUserRecord({ ...(req.body || {}), username });
      if (!user) return res.status(400).json({ error: 'invalid_user' });
      await withMirrorWriteTx(pool, async (client) => {
        await mergeStateFieldsOnClient(client, tid, { users: [user] }, { users: 'username' });
      });
      return res.json({ ok: true, item: user });
    } catch (e) {
      log.error({ msg: 'put_api_hrms_users_username', request_id: req.requestId, err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.delete('/api/hrms-users/:username', authRequired, async (req, res) => {
    if (!requireRemainingStateAdmin(req, res)) return;
    const username = String(req.params?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    try {
      const tid = resolveTenantId(req);
      await withMirrorWriteTx(pool, async (client) => {
        const { current } = await readHrmsStateForUpdate(client, tid);
        const result = removeUserFromList(current.users, username);
        if (!result.ok) {
          const err = new Error('not_found');
          err.code = 'not_found';
          throw err;
        }
        await patchHrmsStateFieldsOnClient(client, tid, { users: result.list });
      });
      return res.json({ ok: true });
    } catch (e) {
      if (e?.code === 'not_found') return res.status(404).json({ error: 'not_found' });
      log.error({ msg: 'delete_api_hrms_users_username', request_id: req.requestId, err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/hrms-users/import', authRequired, async (req, res) => {
    if (!requireRemainingStateAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const incoming = Array.isArray(req.body?.users) ? req.body.users : [];
      if (!incoming.length) return res.status(400).json({ error: 'empty' });
      const result = await withMirrorWriteTx(pool, async (client) => {
        const { current } = await readHrmsStateForUpdate(client, tid);
        const merged = upsertUsersInList(current.users, incoming);
        await patchHrmsStateFieldsOnClient(client, tid, { users: merged.list });
        return merged;
      });
      return res.json({ ok: true, count: result.upserted.length, items: result.list });
    } catch (e) {
      log.error({ msg: 'post_api_hrms_users_import', request_id: req.requestId, err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
