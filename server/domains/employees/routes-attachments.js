import fs from 'fs';
import path from 'path';

/**
 * @param {import('express').Router} router
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: any,
 *   upload: import('multer').Multer,
 *   recordUploadOwnership: (filename: string, tenantId: string, uploadedBy: string) => Promise<void>,
 *   uploadsDir: string,
 *   resolveTenantIdDefault: () => string,
 * }} deps
 */
export function registerEmployeeAttachmentsRoutes(router, authRequired, deps) {
  const { pool, upload, recordUploadOwnership, uploadsDir, resolveTenantIdDefault } = deps;

  router.get('/:empId/attachments', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    const allowed = ['admin', 'store_manager', 'hr_manager', 'hq_manager'];
    if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const empId = String(req.params.empId || '').trim();
      if (!empId) return res.status(400).json({ error: 'missing_emp_id' });
      const r = await pool.query('select * from employee_attachments where employee_id=$1 order by created_at desc', [empId]);
      return res.json(r.rows);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  router.post('/:empId/attachments', authRequired, upload.single('file'), async (req, res) => {
    const role = String(req.user?.role || '').trim();
    const allowed = ['admin', 'store_manager', 'hr_manager'];
    if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const empId = String(req.params.empId || '').trim();
      if (!empId) return res.status(400).json({ error: 'missing_emp_id' });
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'missing_file' });
      if (file.size > 20 * 1024 * 1024) return res.status(400).json({ error: 'file_too_large' });
      await recordUploadOwnership(file.filename, req.tenantId, req.user?.username);
      const url = `/uploads/${file.filename}`;
      const originalName = String(file.originalname || file.filename);
      const description = String(req.body?.description || '').slice(0, 200);
      const uploadedBy = String(req.user?.username || '');
      const r = await pool.query(
        'insert into employee_attachments(employee_id,filename,original_name,url,description,uploaded_by,tenant_id) values($1,$2,$3,$4,$5,$6,$7) returning *',
        [empId, file.filename, originalName, url, description, uploadedBy, resolveTenantIdDefault()]
      );
      return res.json(r.rows[0]);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  router.delete('/:empId/attachments/:attachId', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    const allowed = ['admin', 'store_manager', 'hr_manager'];
    if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
    try {
      const empId = String(req.params.empId || '').trim();
      const attachId = String(req.params.attachId || '').trim();
      if (!empId || !attachId) return res.status(400).json({ error: 'missing_params' });
      const r = await pool.query('delete from employee_attachments where id=$1 and employee_id=$2 returning filename', [attachId, empId]);
      if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
      try {
        const filename = r.rows[0]?.filename;
        if (filename) {
          const filepath = path.join(uploadsDir, filename);
          fs.unlink(filepath, () => {});
        }
      } catch (e2) { /* ignore */ }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
