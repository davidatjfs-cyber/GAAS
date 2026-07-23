import {
  normalizeUserRecord,
  removeAnnouncementFromList,
  removeUserFromList,
  upsertUsersInList,
} from './service.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   getSharedState: (tenantId?: string)=>Promise<object|null>,
 *   saveSharedState: (data: object, tenantId?: string)=>Promise<any>,
 *   mergeSharedStateFields: (patches: object, arrayIdFields?: object, tenantId?: string)=>Promise<void>,
 *   resolveTenantId: (req)=>string,
 * }} deps
 */
export function registerRemainingStateRoutes(app, authRequired, deps) {
  const { getSharedState, saveSharedState, mergeSharedStateFields, resolveTenantId } = deps;

  function requireAdmin(req, res) {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin' && role !== 'hq_manager') {
      res.status(403).json({ error: 'forbidden', message: '仅管理员可操作' });
      return false;
    }
    return true;
  }

  // ── announcements ───────────────────────────────────────────
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
    if (!requireAdmin(req, res)) return;
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
      await mergeSharedStateFields({ announcements: [item] }, { announcements: 'id' }, tid);
      return res.json({ ok: true, item });
    } catch (e) {
      console.error('[POST /api/announcements]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.delete('/api/announcements/:id', authRequired, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const tid = resolveTenantId(req);
      const state0 = (await getSharedState(tid)) || {};
      const result = removeAnnouncementFromList(state0.announcements, id);
      if (!result.ok) return res.status(404).json({ error: 'not_found' });
      await saveSharedState({ ...state0, announcements: result.list }, tid);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/announcements/:id]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // ── exam question bank / assignments ────────────────────────
  app.get('/api/exam/question-bank', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state = (await getSharedState(tid)) || {};
      return res.json({
        questionBank: Array.isArray(state.questionBank) ? state.questionBank : [],
        questionSets: Array.isArray(state.questionSets) ? state.questionSets : [],
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.put('/api/exam/question-bank', authRequired, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const state0 = (await getSharedState(tid)) || {};
      const questionBank = Array.isArray(req.body?.questionBank) ? req.body.questionBank : [];
      const questionSets = Array.isArray(req.body?.questionSets) ? req.body.questionSets : [];
      await saveSharedState({ ...state0, questionBank, questionSets }, tid);
      return res.json({ ok: true, questionBank, questionSets });
    } catch (e) {
      console.error('[PUT /api/exam/question-bank]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/exam/assignments', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state = (await getSharedState(tid)) || {};
      const items = Array.isArray(state.examAssignments) ? state.examAssignments : [];
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/exam/assignments', authRequired, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const assignment = req.body?.assignment && typeof req.body.assignment === 'object' ? req.body.assignment : req.body;
      if (!assignment || typeof assignment !== 'object') return res.status(400).json({ error: 'missing_assignment' });
      const item = {
        ...assignment,
        id: String(assignment.id || '').trim() || `asg_${Date.now()}`,
        createdAt: String(assignment.createdAt || new Date().toISOString()),
        createdBy: String(assignment.createdBy || req.user?.username || '').trim(),
      };
      await mergeSharedStateFields({ examAssignments: [item] }, { examAssignments: 'id' }, tid);
      return res.json({ ok: true, item });
    } catch (e) {
      console.error('[POST /api/exam/assignments]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // ── training materials ──────────────────────────────────────
  app.get('/api/training-materials', authRequired, async (req, res) => {
    try {
      const tid = resolveTenantId(req);
      const state = (await getSharedState(tid)) || {};
      return res.json({ items: Array.isArray(state.trainingMaterials) ? state.trainingMaterials : [] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.put('/api/training-materials', authRequired, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const state0 = (await getSharedState(tid)) || {};
      const items = Array.isArray(req.body?.items)
        ? req.body.items
        : Array.isArray(req.body?.trainingMaterials)
          ? req.body.trainingMaterials
          : [];
      await saveSharedState({ ...state0, trainingMaterials: items }, tid);
      return res.json({ ok: true, items });
    } catch (e) {
      console.error('[PUT /api/training-materials]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // ── hrms_state.users（登录镜像；与 employees 表并行）────────
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
    if (!requireAdmin(req, res)) return;
    const username = String(req.params?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    try {
      const tid = resolveTenantId(req);
      const user = normalizeUserRecord({ ...(req.body || {}), username });
      if (!user) return res.status(400).json({ error: 'invalid_user' });
      await mergeSharedStateFields({ users: [user] }, { users: 'username' }, tid);
      return res.json({ ok: true, item: user });
    } catch (e) {
      console.error('[PUT /api/hrms-users/:username]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.delete('/api/hrms-users/:username', authRequired, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const username = String(req.params?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_username' });
    try {
      const tid = resolveTenantId(req);
      const state0 = (await getSharedState(tid)) || {};
      const result = removeUserFromList(state0.users, username);
      if (!result.ok) return res.status(404).json({ error: 'not_found' });
      await saveSharedState({ ...state0, users: result.list }, tid);
      return res.json({ ok: true });
    } catch (e) {
      console.error('[DELETE /api/hrms-users/:username]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/hrms-users/import', authRequired, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tid = resolveTenantId(req);
      const incoming = Array.isArray(req.body?.users) ? req.body.users : [];
      if (!incoming.length) return res.status(400).json({ error: 'empty' });
      const state0 = (await getSharedState(tid)) || {};
      const { list, upserted } = upsertUsersInList(state0.users, incoming);
      await saveSharedState({ ...state0, users: list }, tid);
      return res.json({ ok: true, count: upserted.length, items: list });
    } catch (e) {
      console.error('[POST /api/hrms-users/import]', e?.message || e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
