/**
 * Upload POST routes (behavior-preserving extract from index.js).
 * registerUploadRoutes(app, authRequired, deps)
 */
import { canWriteDailyReports } from '../daily-reports/helpers.js';
import { canApplyPointsByRole } from '../points/helpers.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   upload: import('multer').Multer,
 *   recordUploadOwnership: (filenames: string | (string | undefined)[], tenantId: string, uploadedBy: string) => Promise<void>,
 * }} deps
 */
export function registerUploadRoutes(app, authRequired, deps) {
  const { upload, recordUploadOwnership } = deps;

  app.post('/api/uploads/daily-report', authRequired, upload.array('files', 9), async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!canWriteDailyReports(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: 'missing_file' });
      await recordUploadOwnership(files.map(f => f?.filename), req.tenantId, req.user?.username);
      const urls = files
        .map(f => (f && f.filename ? `/uploads/${f.filename}` : ''))
        .filter(Boolean);
      return res.json({ urls });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/uploads/employee-idcard', authRequired, upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]), async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!(role === 'admin' || role === 'store_manager' || role === 'hr_manager')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const files = req.files && typeof req.files === 'object' ? req.files : {};
      const front = Array.isArray(files.front) ? files.front[0] : null;
      const back = Array.isArray(files.back) ? files.back[0] : null;
      if (!front && !back) return res.status(400).json({ error: 'missing_file' });
      await recordUploadOwnership([front?.filename, back?.filename], req.tenantId, req.user?.username);
      const frontUrl = front?.filename ? `/uploads/${front.filename}` : '';
      const backUrl = back?.filename ? `/uploads/${back.filename}` : '';
      return res.json({ frontUrl, backUrl });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/uploads/points-evidence', authRequired, upload.array('files', 6), async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!canApplyPointsByRole(role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: 'missing_file' });
      await recordUploadOwnership(files.map(f => f?.filename), req.tenantId, req.user?.username);
      const urls = files
        .map(f => (f && f.filename ? `/uploads/${f.filename}` : ''))
        .filter(Boolean);
      return res.json({ urls });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/uploads/agent-task-evidence', authRequired, upload.array('files', 9), async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: 'missing_file' });
      await recordUploadOwnership(files.map(f => f?.filename), req.tenantId, req.user?.username);
      const urls = files.map(f => (f && f.filename ? `/uploads/${f.filename}` : '')).filter(Boolean);
      return res.json({ urls });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/uploads/ops-task-evidence', authRequired, upload.array('files', 9), async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (!files.length) return res.status(400).json({ error: 'missing_file' });
      await recordUploadOwnership(files.map(f => f?.filename), req.tenantId, username);
      const urls = files.map(f => (f && f.filename ? `/uploads/${f.filename}` : '')).filter(Boolean);
      return res.json({ urls });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
