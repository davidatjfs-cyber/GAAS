/**
 * Upload routes (behavior-preserving extract from index.js).
 * registerUploadRoutes(app, authRequired, deps)
 */
import fs from 'fs';
import path from 'path';
import { canWriteDailyReports } from '../daily-reports/helpers.js';
import { canApplyPointsByRole } from '../points/helpers.js';
import { resolveUploadRelPath } from './path.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   upload: import('multer').Multer,
 *   recordUploadOwnership: (filenames: string | (string | undefined)[], tenantId: string, uploadedBy: string) => Promise<void>,
 *   pool: import('pg').Pool,
 *   uploadsDir: string,
 * }} deps
 */
export function registerUploadRoutes(app, authRequired, deps) {
  const { upload, recordUploadOwnership, pool, uploadsDir } = deps;

  // 2026-06-25 文件存储租户隔离：/uploads 之前用express.static公开裸露，任何人拿到URL
  // (哪怕是员工身份证照片)不用登录就能直接看，且没有租户边界。改为鉴权路由按文件归属
  // 租户校验后才流式返回。URL路径不变(/uploads/<...>)，老链接不受影响，只是访问方式变了。
  app.get('/uploads/*', authRequired, async (req, res) => {
    try {
      const normalizedRel = resolveUploadRelPath(req.params[0]);
      if (!normalizedRel) {
        return res.status(400).json({ error: 'invalid_path' });
      }
      const fullPath = path.join(uploadsDir, normalizedRel);
      if (!fullPath.startsWith(uploadsDir)) return res.status(400).json({ error: 'invalid_path' });
      if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'not_found' });

      const filename = path.basename(normalizedRel);
      const reqTenantId = String(req.tenantId || 'default').trim() || 'default';
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin') {
        let ownerTenantId = 'default';
        try {
          const r = await pool.query(`SELECT tenant_id FROM upload_file_owners WHERE filename = $1 LIMIT 1`, [filename]);
          ownerTenantId = r.rows?.[0]?.tenant_id || 'default';
        } catch (_) { /* 查询失败：保守按default处理，不放行非default租户 */ }
        if (ownerTenantId !== reqTenantId) return res.status(403).json({ error: 'forbidden' });
      }
      return res.sendFile(fullPath);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/growth/upload', authRequired, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
      await recordUploadOwnership(req.file.filename, req.tenantId, req.user?.username);
      const url = `/uploads/${req.file.filename}`;
      return res.json({ ok: true, url, filename: req.file.filename, size: req.file.size });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'upload_failed' });
    }
  });

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
