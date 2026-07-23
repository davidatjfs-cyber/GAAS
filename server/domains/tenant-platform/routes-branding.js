import {
  getTenantPlatformProfile,
} from './helpers.js';

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformBrandingRoutes(app, deps) {
  const { pool, platformAdminRequired, upload, recordUploadOwnership } = deps;

  // 平台管理员上传租户logo：返回/uploads/<file>的URL，再由前端把这个URL写进profile.logo_url保存
  app.post('/api/admin/tenants/:tenantId/logo', platformAdminRequired, upload.single('file'), async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      if (!req.file) return res.status(400).json({ error: 'missing_file' });
      await recordUploadOwnership(req.file.filename, tenantId, req.platformAdmin?.username);
      return res.json({ ok: true, url: `/uploads/${req.file.filename}` });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  // 租户品牌信息公开只读端点：登录页/前端在拿到token之前就需要展示租户名字和logo，
  // 所以这里不挂platformAdminRequired/authRequired，只读取非敏感的展示字段。
  app.get('/api/tenant/branding', async (req, res) => {
    try {
      const tenantId = String(req.query?.tenant_id || 'default').trim() || 'default';
      const tenantRow = await pool.query('SELECT name FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      const fallbackName = tenantRow.rows?.[0]?.name || '';
      const profile = await getTenantPlatformProfile(pool, tenantId, fallbackName);
      return res.json({
        ok: true,
        system_name: profile.system_name || fallbackName || '年年有喜管理系统',
        logo_url: profile.logo_url || '',
        favicon_url: profile.favicon_url || '',
        brand_color: profile.brand_color || '#0d7a5f'
      });
    } catch (e) {
      return res.json({ ok: false, system_name: '年年有喜管理系统', logo_url: '', favicon_url: '', brand_color: '#0d7a5f' });
    }
  });
}
