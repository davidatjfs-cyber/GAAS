/**
 * Knowledge base write routes (CRUD / batch / presign / create).
 */
import {
  putKnowledgeExplanation,
  reformatExplanation,
  regenerateExplanation,
  putKnowledgeGroupId,
  putGroupMeta,
  deleteGroup,
  deleteKnowledge,
  putKnowledge,
  batchUploadKnowledge,
  putKnowledgeScope,
  presignKnowledge,
  directCreateKnowledge,
  createKnowledge,
  runCreateKnowledgeBackground,
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

export function registerKnowledgeWriteRoutes(app, deps) {
  const { authRequired, knowledgeUpload, ...rest } = deps;
  const ctx = rest;

  app.put('/api/knowledge/:id/explanation', authRequired, async (req, res) => {
    const result = await putKnowledgeExplanation(ctx, {
      role: req.user?.role,
      id: req.params?.id,
      explanation: req.body?.explanation,
      username: req.user?.username,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/knowledge/:id/explanation/reformat', authRequired, async (req, res) => {
    const result = await reformatExplanation(ctx, {
      role: req.user?.role,
      id: req.params?.id,
      username: req.user?.username,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/knowledge/:id/explanation/regenerate', authRequired, async (req, res) => {
    const result = await regenerateExplanation(ctx, {
      role: req.user?.role,
      id: req.params?.id,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.put('/api/knowledge/:id/group', authRequired, async (req, res) => {
    const result = await putKnowledgeGroupId(ctx, {
      role: req.user?.role,
      id: req.params?.id,
      groupId: req.body?.groupId,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.put('/api/knowledge/group/:groupId', authRequired, async (req, res) => {
    const result = await putGroupMeta(ctx, {
      role: req.user?.role,
      groupId: req.params?.groupId,
      body: req.body,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.delete('/api/knowledge/group/:groupId', authRequired, async (req, res) => {
    const result = await deleteGroup(ctx, {
      role: req.user?.role,
      groupId: req.params?.groupId,
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({ ok: true, deleted: result.deleted });
  });

  app.delete('/api/knowledge/:id', authRequired, async (req, res) => {
    const result = await deleteKnowledge(ctx, {
      role: req.user?.role,
      id: req.params?.id,
    });
    if (!result.ok) return sendFail(res, result);
    return res.json({ ok: true });
  });

  app.put('/api/knowledge/:id', authRequired, async (req, res) => {
    const result = await putKnowledge(ctx, {
      role: req.user?.role,
      id: req.params?.id,
      body: req.body,
      username: req.user?.username,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/knowledge/batch', authRequired, knowledgeUpload.array('files', 10), async (req, res) => {
    const result = await batchUploadKnowledge(ctx, {
      role: req.user?.role,
      files: req.files || [],
      body: req.body,
      username: req.user?.username,
      userId: req.user?.id,
      tenantId: req.tenantId,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.put('/api/knowledge/:id/scope', authRequired, async (req, res) => {
    const result = await putKnowledgeScope(ctx, {
      role: req.user?.role,
      id: req.params?.id,
      scope: req.body?.scope,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/knowledge/presign', authRequired, async (req, res) => {
    const result = await presignKnowledge(ctx, {
      role: req.user?.role,
      body: req.body,
      tenantId: req.tenantId,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/knowledge/direct', authRequired, async (req, res) => {
    const result = await directCreateKnowledge(ctx, {
      role: req.user?.role,
      body: req.body,
      userId: req.user?.id,
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/knowledge', authRequired, knowledgeUpload.single('file'), async (req, res) => {
    const result = await createKnowledge(ctx, {
      role: req.user?.role,
      body: req.body,
      file: req.file,
      userId: req.user?.id,
      username: req.user?.username,
      tenantId: req.tenantId,
    });
    if (!result.ok) return sendFail(res, result);
    res.json({ item: result.item, queued: true });
    if (result.background) {
      void runCreateKnowledgeBackground(ctx, result.background);
    }
  });
}
