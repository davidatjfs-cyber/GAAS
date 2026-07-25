import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { SYSTEM_TENANT_ID, tenantContext } from '../../utils/database.js';
import { createEmptyTenantState } from '../../tenant-login.js';
import { getTenantIntegrationSummary } from '../../tenant-integrations.js';
import {
  agentsAdminHtmlPath,
  platformAdminHtmlPath,
  buildTenantAlerts,
  buildTenantLoginAccess,
  computeLicenseCountdown,
  DEFAULT_PLATFORM_PROFILE,
  getTenantPlatformAcceptanceReport,
  getTenantPlatformProfile,
  mergePlatformProfile,
  runTenantAcceptance,
  saveTenantPlatformAcceptanceReport,
  saveTenantPlatformProfile,
} from './helpers.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'tenant-platform', handler: 'routes-tenants' });


/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformTenantsRoutes(app, deps) {
  const {
    pool,
    platformAdminRequired,
    TENANT_INTEGRATION_ENCRYPTION_KEY,
    REQUIRED_TENANT_FEISHU_TABLE_KEYS,
  } = deps;

  const acceptanceOpts = {
    tenantIntegrationEncryptionKey: TENANT_INTEGRATION_ENCRYPTION_KEY,
    requiredTenantFeishuTableKeys: REQUIRED_TENANT_FEISHU_TABLE_KEYS,
  };

  // ─── 租户开通(平台级) ───
  // 鉴权见 platformAdminRequired：与租户内部的 role==='admin' 完全分离，因为
  // 创建租户本身是跨租户操作，任何单租户管理员都不应有权限创建别的租户。
  app.post('/api/admin/tenants', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.body?.tenant_id || '').trim();
    const name = String(req.body?.name || '').trim();
    if (!tenantId || !/^[a-zA-Z0-9_-]{1,80}$/.test(tenantId)) {
      return res.status(400).json({ error: 'invalid_tenant_id', message: 'tenant_id 仅支持字母/数字/下划线/短横线' });
    }
    if (!name) return res.status(400).json({ error: 'missing_name' });
    const mode = String(req.body?.mode || 'managed').trim() || 'managed';
    const adminReq = req.body?.create_admin;
    if (!adminReq?.username || !adminReq?.password) {
      return res.status(400).json({ error: 'missing_admin', message: 'create_admin.username 和 create_admin.password 必填' });
    }

    return tenantContext.run(tenantId, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query('SELECT 1 FROM tenants WHERE tenant_id = $1', [tenantId]);
      if (exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'tenant_exists' });
      }
      await client.query(
        `INSERT INTO tenants (tenant_id, name, mode, status) VALUES ($1, $2, $3, 'provisioning')`,
        [tenantId, name, mode]
      );
      let createdAdmin = null;
      const adminUsername = String(adminReq.username).trim().toLowerCase();
      // username 现在是平台内全局唯一（见 migrations/145），共享单域名登录靠它
      // 在没有租户提示时定位账号，所以这里要在建号前跨租户查重，而不是等
      // 数据库唯一约束报错才发现。查重要临时切到system上下文，否则当前事务
      // 的会话租户还是这个新租户，只能看见它自己的（还不存在的）用户。
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [SYSTEM_TENANT_ID]);
      const dupCheck = await client.query('SELECT 1 FROM users WHERE lower(username) = lower($1) LIMIT 1', [adminUsername]);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      if (dupCheck.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'username_taken', message: `用户名 ${adminUsername} 已被占用（登录账号在平台内全局唯一），请更换后重试` });
      }
      const hash = await bcrypt.hash(String(adminReq.password), 10);
      await client.query(
        `INSERT INTO users (id, username, password_hash, real_name, role, is_active, tenant_id)
         VALUES (gen_random_uuid(), $1, $2, $3, 'admin', TRUE, $4)`,
        [adminUsername, hash, String(adminReq.real_name || adminUsername), tenantId]
      );
      createdAdmin = { username: adminUsername };

      await client.query(
        `INSERT INTO hrms_state (key, data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO NOTHING`,
        [tenantId, JSON.stringify(createEmptyTenantState({
          tenantId,
          tenantName: name,
          adminUsername: createdAdmin?.username || '',
          adminName: String(adminReq?.real_name || createdAdmin?.username || ''),
        }))]
      );

      await saveTenantPlatformProfile(client, tenantId, {
        ...DEFAULT_PLATFORM_PROFILE,
        system_name: name,
        page_title: `${name} 平台控制台`,
        notes: `由平台控制台在 ${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ')} 初始化`,
      });

      // Provisioning acceptance gate: the tenant is not activated until its own
      // context can read the seeded admin and state row.
      const smoke = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM users WHERE tenant_id = $1 AND lower(username) = lower($2)) AS has_admin,
           EXISTS (SELECT 1 FROM hrms_state WHERE key = $1) AS has_state`,
        [tenantId, createdAdmin.username]
      );
      if (!smoke.rows?.[0]?.has_state || !smoke.rows?.[0]?.has_admin) {
        throw new Error('tenant_provisioning_smoke_failed');
      }
      // G1: stay provisioning until runTenantAcceptance passes (do not auto-activate)

      let issuedLicense = null;
      const licenseReq = req.body?.license;
      if (licenseReq && licenseReq.expires_at) {
        const licenseKey = randomUUID();
        const allowedFeatures = Array.isArray(licenseReq.allowed_features) ? licenseReq.allowed_features : [];
        const maxStoresRaw = licenseReq.max_stores;
        const maxStores = maxStoresRaw == null || maxStoresRaw === '' ? null : Number(maxStoresRaw);
        if (maxStores != null && (!Number.isFinite(maxStores) || maxStores < 0)) {
          throw new Error('invalid_max_stores');
        }
        const lr = await client.query(
          `INSERT INTO licenses (tenant_id, license_key, expires_at, allowed_features, max_stores)
           VALUES ($1, $2, $3, $4, $5) RETURNING license_key, expires_at, status, max_stores`,
          [tenantId, licenseKey, licenseReq.expires_at, JSON.stringify(allowedFeatures), maxStores]
        );
        issuedLicense = lr.rows[0];
      }

      await client.query('COMMIT');

      let acceptance = null;
      let finalStatus = 'provisioning';
      try {
        acceptance = await runTenantAcceptance(pool, tenantId, acceptanceOpts);
        await saveTenantPlatformAcceptanceReport(pool, tenantId, {
          ...acceptance,
          checked_at: new Date().toISOString(),
          action: 'provision',
        });
        if (acceptance?.ok) {
          await pool.query(`UPDATE tenants SET status = 'active', updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
          finalStatus = 'active';
        }
      } catch (accErr) {
        log.warn({ msg: 'provision_acceptance_failed_tenant_stays_provisioning', err: accErr?.message || accErr });
        acceptance = { ok: false, error: accErr?.message || 'acceptance_error' };
      }

      const login_access = await buildTenantLoginAccess(pool, req, tenantId, { password: adminReq.password });
      return res.json({
        ok: true,
        tenant: { tenant_id: tenantId, name, mode, status: finalStatus },
        admin: createdAdmin,
        license: issuedLicense,
        login_access,
        acceptance,
        message: finalStatus === 'active' ? '租户已开通并验收通过' : '租户已创建，验收未通过，保持 provisioning（请补齐 license/飞书后重新验收）',
      });
    } catch (e) {
      await client.query('ROLLBACK');
      if (e?.code === '23505' && String(e?.constraint || '').includes('username')) {
        return res.status(409).json({ error: 'username_taken', message: '用户名已被占用（登录账号在平台内全局唯一），请更换后重试' });
      }
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    } finally {
      client.release();
    }
    });
  });

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
}
