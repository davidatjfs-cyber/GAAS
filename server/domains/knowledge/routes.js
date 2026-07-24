/**
 * Knowledge base HTTP routes — thin handlers.
 * Business logic lives in service.js; multer upload stays here.
 */
import path from 'path';
import { Readable } from 'stream';
import {
  getKnowledgeFile,
  listKnowledge,
  listKnowledgeGroups,
  getKnowledgeGroup,
  getKnowledgeContent,
  getKnowledgeExplanation,
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

export function registerKnowledgeRoutes(app, deps) {
  const {
    authRequired,
    authRequiredOrQueryToken,
    knowledgeUpload,
    getKnowledgeViewerProfile,
    inferContentType,
    ...rest
  } = deps;
  const ctx = { ...rest, inferContentType };

  app.get('/api/knowledge/:id/file', authRequiredOrQueryToken, async (req, res) => {
    const result = await getKnowledgeFile(ctx, {
      id: req.params?.id,
      getViewer: () => getKnowledgeViewerProfile(req),
    });
    if (!result.ok) return sendFail(res, result);

    if (result.delivery === 'local') {
      try {
        const ft = String(result.fileType || '').trim();
        const originalName = path.basename(result.absPath);
        const fallback = inferContentType({ declaredType: ft, originalName, mimeType: '' });
        if (fallback && !res.getHeader('Content-Type')) res.setHeader('Content-Type', fallback);
      } catch (e) { /* ignore */ }
      return res.sendFile(result.absPath);
    }

    const filePath = result.filePath;
    const upstreamHeaders = {};
    try {
      const r = String(req.headers?.range || '').trim();
      if (r) upstreamHeaders['Range'] = r;
    } catch (e) { /* ignore */ }

    try {
      const upstream = await fetch(filePath, { headers: upstreamHeaders });
      if (!upstream.ok || !upstream.body) {
        return res.status(502).json({ error: 'upstream_failed', status: upstream.status });
      }

      const contentType = upstream.headers.get('content-type') || '';
      const disposition = upstream.headers.get('content-disposition') || '';
      const contentRange = upstream.headers.get('content-range') || '';
      const acceptRanges = upstream.headers.get('accept-ranges') || '';
      const contentLength = upstream.headers.get('content-length') || '';
      if (contentType) res.setHeader('Content-Type', contentType);
      if (disposition) res.setHeader('Content-Disposition', disposition);
      if (contentRange) res.setHeader('Content-Range', contentRange);
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
      if (contentLength) res.setHeader('Content-Length', contentLength);

      res.status(upstream.status || 200);

      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.on('error', () => {
        try {
          res.end();
        } catch (e) { /* ignore */ }
      });
      return nodeStream.pipe(res);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

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
