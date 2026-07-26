/**
 * Knowledge base read routes (list / groups / content / explanation).
 */
import {
  listKnowledge,
  listKnowledgeGroups,
  getKnowledgeGroup,
  getKnowledgeContent,
  getKnowledgeExplanation,
} from './service.js';

function sendFail(res, result) {
  const { ok: _ok, status, ...body } = result;
  return res.status(status || 500).json(body);
}

function sendOk(res, result) {
  const { ok: _ok, status: _status, background: _bg, delivery: _d, absPath: _a, fileType: _ft, filePath: _fp, passthrough, ...body } = result;
  if (passthrough !== undefined) return res.json(passthrough);
  return res.json(body);
}

export function registerKnowledgeReadRoutes(app, deps) {
  const { authRequired, getKnowledgeViewerProfile, ...rest } = deps;
  const ctx = rest;

  app.get('/api/knowledge', authRequired, async (req, res) => {
    try {
      const viewer = await getKnowledgeViewerProfile(req);
      const result = await listKnowledge(ctx, { viewer, query: req.query });
      if (!result.ok) return sendFail(res, result);
      return sendOk(res, result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/knowledge/groups', authRequired, async (req, res) => {
    try {
      const viewer = await getKnowledgeViewerProfile(req);
      const result = await listKnowledgeGroups(ctx, { viewer });
      if (!result.ok) return sendFail(res, result);
      return sendOk(res, result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/knowledge/group/:groupId', authRequired, async (req, res) => {
    try {
      const viewer = await getKnowledgeViewerProfile(req);
      const result = await getKnowledgeGroup(ctx, {
        viewer,
        groupId: req.params?.groupId,
      });
      if (!result.ok) return sendFail(res, result);
      return sendOk(res, result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/knowledge/:id/content', authRequired, async (req, res) => {
    try {
      const viewer = await getKnowledgeViewerProfile(req);
      const result = await getKnowledgeContent(ctx, {
        viewer,
        id: req.params?.id,
      });
      if (!result.ok) return sendFail(res, result);
      return sendOk(res, result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: String(e?.message || e) });
    }
  });

  app.get('/api/knowledge/:id/explanation', authRequired, async (req, res) => {
    const result = await getKnowledgeExplanation(ctx, {
      role: req.user?.role,
      id: req.params?.id,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });
}
