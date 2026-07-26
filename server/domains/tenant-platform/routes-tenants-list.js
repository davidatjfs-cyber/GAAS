
import { tenantContext } from '../../utils/database.js';

import { getTenantIntegrationSummary } from '../../tenant-integrations.js';
import {
  computeLicenseCountdown,
  mergePlatformProfile,
} from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const _log = childLogger({ domain: 'tenant-platform', handler: 'routes-tenants' });

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */

export function registerTenantPlatformTenantsListRoutes(app, deps) {
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

  app.get('/api/admin/tenants', platformAdminRequired, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT t.tenant_id, t.name, t.mode, t.status, t.created_at,
               l.license_key, l.expires_at AS license_expires_at, l.status AS license_status
        FROM tenants t
        LEFT JOIN LATERAL (
          SELECT license_key, expires_at, status FROM licenses
          WHERE licenses.tenant_id = t.tenant_id
          ORDER BY created_at DESC LIMIT 1
        ) l ON true
        ORDER BY t.created_at DESC
      `);
      const items = r.rows || [];
      const profileRows = await pool.query(`SELECT tenant_key, config_value FROM tenant_config WHERE config_key = 'platform_profile'`);
      const profileByTenant = new Map(
        profileRows.rows.map((row) => [row.tenant_key, mergePlatformProfile(row.config_value || {}, row.tenant_key)])
      );
      let integrationByTenant = new Map();
      if (TENANT_INTEGRATION_ENCRYPTION_KEY && items.length) {
        const summaries = await Promise.all(
          items.map((row) => tenantContext.run(
            row.tenant_id,
            () => getTenantIntegrationSummary(pool, row.tenant_id, 'feishu_bitable', TENANT_INTEGRATION_ENCRYPTION_KEY)
          ))
        );
        integrationByTenant = new Map(summaries.map((row) => [row.tenant_id, row]));
      }
      return res.json({
        items: items.map((row) => ({
          ...row,
          integrations: {
            feishu_bitable: integrationByTenant.get(row.tenant_id) || {
              tenant_id: row.tenant_id,
              integration_key: 'feishu_bitable',
              configured: false,
              app_id: '',
              tables: [],
            }
          },
          platform_profile: profileByTenant.get(row.tenant_id) || mergePlatformProfile({}, row.name || row.tenant_id),
          license_countdown_days: computeLicenseCountdown(row.license_expires_at),
        }))
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });
}
