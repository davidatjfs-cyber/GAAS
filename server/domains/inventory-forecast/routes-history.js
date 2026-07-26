/**
 * Inventory forecast HTTP routes — thin handlers.
 * Business logic lives in service.js; multer upload stays here.
 */
import fs from 'fs';
import {
  listHistory,
  clearHistory,
  batchHistory,
  uploadHistoryFile,
  uploadHistoryImage,
  uploadSalesRaw,
} from './service.js';

function sendFail(res, result) {
  const { ok: _ok, status, ...body } = result;
  return res.status(status || 500).json(body);
}

/** Strip internal ok/status. Pass keepOk for endpoints that originally returned { ok: true, ... }. */
function sendOk(res, result, { keepOk = false } = {}) {
  const { ok: _ok, status: _status, ...body } = result;
  if (keepOk) return res.json({ ok: true, ...body });
  return res.json(body);
}

export function registerInventoryForecastHistoryRoutes(app, deps) {
  const { authRequired, upload, ...rest } = deps;
  const ctx = { ...rest };

  app.get('/api/reports/inventory-forecast/history', authRequired, async (req, res) => {
    const result = await listHistory(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.delete('/api/reports/inventory-forecast/history/clear', authRequired, async (req, res) => {
    const result = await clearHistory(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.post('/api/reports/inventory-forecast/history/batch', authRequired, async (req, res) => {
    const result = await batchHistory(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result, { keepOk: true });
  });

  app.post('/api/reports/inventory-forecast/history/upload-file', authRequired, upload.single('file'), async (req, res) => {
    try {
      const result = await uploadHistoryFile(ctx, {
        username: req.user?.username,
        role: req.user?.role,
        body: req.body || {},
        file: req.file ? {
          path: req.file.path,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          buffer: req.file.buffer,
        } : null,
      });
      if (!result.ok) return sendFail(res, result);
      return sendOk(res, result, { keepOk: true });
    } finally {
      try {
        const p = String(req.file?.path || '').trim();
        if (p) fs.unlinkSync(p);
      } catch (e) { /* ignore */ }
    }
  });

  app.post('/api/reports/inventory-forecast/history/upload-image', authRequired, upload.single('file'), async (req, res) => {
    const result = await uploadHistoryImage(ctx, {
      username: req.user?.username,
      role: req.user?.role,
      query: req.query || {},
      body: req.body || {},
      params: req.params || {},
    });
    if (!result.ok) return sendFail(res, result);
    return sendOk(res, result);
  });

  app.post('/api/reports/sales-raw/upload', authRequired, upload.single('file'), async (req, res) => {
    try {
      const result = await uploadSalesRaw(ctx, {
        username: req.user?.username,
        role: req.user?.role,
        body: req.body || {},
        file: req.file || null,
      });
      if (!result.ok) return sendFail(res, result);
      return sendOk(res, result);
    } finally {
      try { if (req.file?.path) fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    }
  });
}
