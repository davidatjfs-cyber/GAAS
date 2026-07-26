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

export function registerTenantPlatformTenantsCreateRoutes(app, deps) {
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
}
