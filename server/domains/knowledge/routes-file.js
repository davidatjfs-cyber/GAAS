/**
 * GET /api/knowledge/:id/file — local sendFile or upstream stream proxy.
 */
import path from 'path';
import { Readable } from 'stream';
import { getKnowledgeFile } from './service.js';

function sendFail(res, result) {
  const { ok: _ok, status, ...body } = result;
  return res.status(status || 500).json(body);
}

export function registerKnowledgeFileRoute(app, deps) {
  const { authRequiredOrQueryToken, getKnowledgeViewerProfile, inferContentType, ...rest } = deps;
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
}
