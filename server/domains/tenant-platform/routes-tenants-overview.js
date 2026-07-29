
import { tenantContext } from '../../utils/database.js';

import { getTenantIntegrationSummary } from '../../tenant-integrations.js';
import {
  buildTenantAlerts,
  buildTenantLoginUrl,
  computeLicenseCountdown,
  mergePlatformProfile,
} from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const _log = childLogger({ domain: 'tenant-platform', handler: 'routes-tenants' });

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */

export function registerTenantPlatformTenantsOverviewRoutes(app, deps) {
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

  app.get('/api/admin/tenants/overview', platformAdminRequired, async (req, res) => {
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
      const acceptanceRows = await pool.query(`SELECT tenant_key, config_value FROM tenant_config WHERE config_key = 'platform_acceptance_report'`);
      const profileByTenant = new Map(
        profileRows.rows.map((row) => [row.tenant_key, mergePlatformProfile(row.config_value || {}, row.tenant_key)])
      );
      const acceptanceByTenant = new Map(acceptanceRows.rows.map((row) => [row.tenant_key, row.config_value || null]));

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

      const hydrated = items.map((row) => {
        const profile = profileByTenant.get(row.tenant_id) || mergePlatformProfile({}, row.name || row.tenant_id);
        const feishu = integrationByTenant.get(row.tenant_id) || {
          tenant_id: row.tenant_id,
          integration_key: 'feishu_bitable',
          configured: false,
          app_id: '',
          tables: [],
        };
        const acceptance_report = acceptanceByTenant.get(row.tenant_id) || null;
        const alerts = buildTenantAlerts(row, row, profile, feishu);
        const billing = profile.billing || {};
        const alertLevels = alerts.reduce((acc, item) => {
          const level = String(item.level || 'info').trim();
          acc[level] = (acc[level] || 0) + 1;
          return acc;
        }, {});
        return {
          ...row,
          platform_profile: profile,
          integrations: { feishu_bitable: feishu },
          acceptance_report,
          alerts,
          alert_levels: alertLevels,
          billing,
          license_countdown_days: computeLicenseCountdown(row.license_expires_at),
          login_url: buildTenantLoginUrl(req, row.tenant_id),
        };
      });

      const summary = {
        total: hydrated.length,
        active: hydrated.filter((row) => row.status === 'active').length,
        feishu_configured: hydrated.filter((row) => row.integrations?.feishu_bitable?.configured).length,
        license_expiring_30d: hydrated.filter((row) => Number.isFinite(Number(row.license_countdown_days)) && Number(row.license_countdown_days) <= 30).length,
        alerts_total: hydrated.reduce((sum, row) => sum + (Array.isArray(row.alerts) ? row.alerts.length : 0), 0),
        alerts_warn: hydrated.reduce((sum, row) => sum + Number(row.alert_levels?.warn || 0), 0),
        alerts_error: hydrated.reduce((sum, row) => sum + Number(row.alert_levels?.error || 0), 0),
        acceptance_failed: hydrated.filter((row) => row.acceptance_report && row.acceptance_report.ok === false).length,
        billing_configured: hydrated.filter((row) => String(row.platform_profile?.billing?.plan_name || '').trim()).length,
        self_hosted: hydrated.filter((row) => row.mode === 'self_hosted').length,
        managed: hydrated.filter((row) => row.mode !== 'self_hosted').length,
      };

      const alerts = hydrated.flatMap((row) => (Array.isArray(row.alerts) ? row.alerts.map((alert) => ({
        tenant_id: row.tenant_id,
        tenant_name: row.platform_profile?.system_name || row.name || row.tenant_id,
        status: row.status,
        license_countdown_days: row.license_countdown_days,
        billing: row.billing || {},
        ...alert,
      })) : []));

      const billingItems = hydrated
        .filter((row) => row.billing && (row.billing.plan_name || row.billing.billing_cycle || row.billing.billing_contact || row.license_expires_at))
        .map((row) => ({
          tenant_id: row.tenant_id,
          tenant_name: row.platform_profile?.system_name || row.name || row.tenant_id,
          status: row.status,
          mode: row.mode,
          plan_name: row.billing?.plan_name || '',
          billing_cycle: row.billing?.billing_cycle || '',
          billing_contact: row.billing?.billing_contact || '',
          next_invoice_at: row.billing?.next_invoice_at || '',
          license_expires_at: row.license_expires_at || '',
          license_countdown_days: row.license_countdown_days,
        }));

      const acceptanceItems = hydrated.map((row) => ({
        tenant_id: row.tenant_id,
        tenant_name: row.platform_profile?.system_name || row.name || row.tenant_id,
        status: row.status,
        mode: row.mode,
        license_status: row.license_status || '',
        license_countdown_days: row.license_countdown_days,
        acceptance_report: row.acceptance_report,
        accepted_ok: row.acceptance_report ? !!row.acceptance_report.ok : null,
        acceptance_action: row.acceptance_report?.action || 'acceptance',
        checked_at: row.acceptance_report?.checked_at || row.acceptance_report?.checkedAt || '',
        checks: Array.isArray(row.acceptance_report?.checks) ? row.acceptance_report.checks : [],
      }));

      return res.json({ ok: true, summary, items: hydrated, alerts, billing: billingItems, acceptance: acceptanceItems });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });
}
