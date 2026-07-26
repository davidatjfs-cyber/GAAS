import { childLogger } from '../../utils/logger.js';
import {
  mergeStateFieldsOnClient,
  patchHrmsStateFieldsOnClient,
  readHrmsStateForUpdate,
  withMirrorWriteTx,
} from '../shared/mirror-tx.js';
import { removeAnnouncementFromList } from './service.js';

const log = childLogger({ domain: 'remaining-state', handler: 'routes-announcements' });

export function requireRemainingStateAdmin(req, res) {
  const role = String(req.user?.role || '').trim();
  if (role !== 'admin' && role !== 'hq_manager') {
    res.status(403).json({ error: 'forbidden', message: '仅管理员可操作' });
    return false;
  }
  return true;
}

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{ pool: any, getSharedState: Function, resolveTenantId: Function }} deps
 */
export function registerRemainingStateAnnouncementRoutes(app, authRequired, deps) {
  const { pool, getSharedState, resolveTenantId } = deps;

  app.get('/api/announcements', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state = (await getSharedState(tid)) || {};
      const items = Array.isArray(state.announcements) ? state.announcements : [];
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/announcements', authRequired, async (req, res) => {
    if (!requireRemainingStateAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();
      if (!title || !content) return res.status(400).json({ error: 'missing_fields' });
      const item = {
        id: String(body.id || '').trim() || `ANN${Date.now()}`,
        title,
        content,
        level: String(body.level || 'normal').trim() || 'normal',
        requireAck: !!body.requireAck,
        readBy: body.readBy && typeof body.readBy === 'object' ? body.readBy : {},
        scope: body.scope && typeof body.scope === 'object' ? body.scope : { type: 'all' },
        createdAt: String(body.createdAt || new Date().toISOString()),
        createdBy: String(body.createdBy || req.user?.username || '').trim(),
        createdByName: String(body.createdByName || '').trim(),
      };
      if (body.pinned) {
        item.pinned = true;
        item.pin_until = body.pin_until || null;
      }
      await withMirrorWriteTx(pool, async (client) => {
        await mergeStateFieldsOnClient(client, tid, { announcements: [item] }, { announcements: 'id' });
      });
      return res.json({ ok: true, item });
    } catch (e) {
      log.error({ msg: 'post_api_announcements', request_id: req.requestId, err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.delete('/api/announcements/:id', authRequired, async (req, res) => {
    if (!requireRemainingStateAdmin(req, res)) return;
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const tid = resolveTenantId(req);
      await withMirrorWriteTx(pool, async (client) => {
        const { current } = await readHrmsStateForUpdate(client, tid);
        const result = removeAnnouncementFromList(current.announcements, id);
        if (!result.ok) {
          const err = new Error('not_found');
          err.code = 'not_found';
          throw err;
        }
        await patchHrmsStateFieldsOnClient(client, tid, { announcements: result.list });
      });
      return res.json({ ok: true });
    } catch (e) {
      if (e?.code === 'not_found') return res.status(404).json({ error: 'not_found' });
      log.error({ msg: 'delete_api_announcements_id', request_id: req.requestId, err: e?.message || e });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
