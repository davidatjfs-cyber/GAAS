
import { tenantContext } from '../../utils/database.js';

import { getTenantIntegrationSummary } from '../../tenant-integrations.js';
import {
  agentsAdminHtmlPath,
  platformAdminHtmlPath,
  buildTenantAlerts,
  buildTenantLoginAccess,
  buildTenantLoginUrl,
  computeLicenseCountdown,
  getTenantPlatformAcceptanceReport,
  getTenantPlatformProfile,
  resetTenantAdminPassword,
  saveTenantPlatformProfile,
} from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const _log = childLogger({ domain: 'tenant-platform', handler: 'routes-tenants' });

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */

export function registerTenantPlatformTenantsProfileRoutes(app, deps) {
  const {
    pool,
    platformAdminRequired,
    TENANT_INTEGRATION_ENCRYPTION_KEY,
    REQUIRED_TENANT_FEISHU_TABLE_KEYS,
  } = deps;

  const _acceptanceOpts = {
    tenantIntegrationEncryptionKey: TENANT_INTEGRATION_ENCRYPTION_KEY,
    requiredTenantFeishuTableKeys: REQUIRED_TENANT_FEISHU_TABLE_KEYS,
  };

  // ─── 租户开通(平台级) ───
  // 鉴权见 platformAdminRequired：与租户内部的 role==='admin' 完全分离，因为
  // 创建租户本身是跨租户操作，任何单租户管理员都不应有权限创建别的租户。

  app.get(['/platform-admin', '/platform-admin/'], (req, res) => {
    return res.sendFile(platformAdminHtmlPath());
  });

  app.get(['/agents-admin', '/agents-admin/'], (req, res) => {
    return res.sendFile(agentsAdminHtmlPath());
  });

  app.get('/api/admin/tenants/:tenantId/profile', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'missing_tenant_id' });
    try {
      const tenantRow = await pool.query(`
        SELECT t.tenant_id, t.name, t.mode, t.status, t.created_at,
               l.license_key, l.expires_at AS license_expires_at, l.status AS license_status
        FROM tenants t
        LEFT JOIN LATERAL (
          SELECT license_key, expires_at, status FROM licenses
          WHERE licenses.tenant_id = t.tenant_id
          ORDER BY created_at DESC LIMIT 1
        ) l ON true
        WHERE t.tenant_id = $1
        LIMIT 1
      `, [tenantId]);
      if (!tenantRow.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const profile = await getTenantPlatformProfile(pool, tenantId, tenantRow.rows[0].name);
      let feishu = {
        tenant_id: tenantId,
        integration_key: 'feishu_bitable',
        configured: false,
        app_id: '',
        tables: [],
      };
      if (TENANT_INTEGRATION_ENCRYPTION_KEY) {
        feishu = await tenantContext.run(
          tenantId,
          () => getTenantIntegrationSummary(pool, tenantId, 'feishu_bitable', TENANT_INTEGRATION_ENCRYPTION_KEY)
        );
      }
      const login_access = await buildTenantLoginAccess(pool, req, tenantId);
      return res.json({
        ok: true,
        tenant: {
          ...tenantRow.rows[0],
          license_countdown_days: computeLicenseCountdown(tenantRow.rows[0].license_expires_at),
        },
        profile,
        acceptance_report: await getTenantPlatformAcceptanceReport(pool, tenantId),
        integrations: { feishu_bitable: feishu },
        alerts: buildTenantAlerts(tenantRow.rows[0], tenantRow.rows[0], profile, feishu),
        login_access,
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.patch('/api/admin/tenants/:tenantId', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const status = req.body?.status ? String(req.body.status).trim() : null;
    const name = req.body?.name ? String(req.body.name).trim() : null;
    if (!status && !name) return res.status(400).json({ error: 'nothing_to_update' });
    try {
      const r = await pool.query(
        `UPDATE tenants SET
           status = COALESCE($2, status),
           name = COALESCE($3, name),
           updated_at = NOW()
         WHERE tenant_id = $1
         RETURNING tenant_id, name, mode, status`,
        [tenantId, status, name]
      );
      if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
      return res.json({ ok: true, tenant: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/profile', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const exists = await pool.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const saved = await saveTenantPlatformProfile(pool, tenantId, req.body?.profile || req.body || {});
      return res.json({ ok: true, profile: saved });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  // 随时可查：登录网址 + 管理员用户名（密码仍无法回读明文）
  app.get('/api/admin/tenants/:tenantId/login-access', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'missing_tenant_id' });
    try {
      const exists = await pool.query('SELECT tenant_id, name FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const login_access = await buildTenantLoginAccess(pool, req, tenantId);
      return res.json({
        ok: true,
        tenant_id: tenantId,
        tenant_name: exists.rows[0].name || '',
        login_access,
        login_url: login_access.login_url || buildTenantLoginUrl(req, tenantId),
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  // 重置租户管理员密码；新临时密码仅本次响应返回
  app.post('/api/admin/tenants/:tenantId/reset-admin-password', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'missing_tenant_id' });
    try {
      const exists = await pool.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const customPassword = req.body?.password != null ? String(req.body.password) : '';
      const result = await resetTenantAdminPassword(pool, tenantId, {
        password: customPassword || undefined,
      });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error, message: result.message });
      const login_access = await buildTenantLoginAccess(pool, req, tenantId, { password: result.temp_password });
      _log.info({ msg: 'tenant_admin_password_reset', tenant_id: tenantId, username: result.username });
      return res.json({
        ok: true,
        tenant_id: result.tenant_id,
        username: result.username,
        temp_password: result.temp_password,
        login_access,
        password_once: true,
        message: '管理员密码已重置；请立即复制临时密码发给客户，系统不会再次显示明文',
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });
}
