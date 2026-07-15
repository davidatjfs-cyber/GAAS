/**
 * Platform tenant admin routes (extracted from index.js — phase H).
 * registerTenantPlatformRoutes(app, deps) — behavior-preserving move.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { tenantContext } from './utils/database.js';
import { createEmptyTenantState } from './tenant-login.js';
import {
  getTenantIntegrationSummary,
  saveTenantFeishuIntegration,
  getTenantIntegrationConfig,
  saveTenantIntegrationConfig,
  getTenantAiModelConfig,
  saveTenantAiModelConfig,
} from './tenant-integrations.js';
import { clearAgentConfigCache } from './agent-config-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPlatformAdminRequired(pool, platformAdminJwtSecret) {
  return async function platformAdminRequired(req, res, next) {
    const token = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    let payload;
    try {
      payload = jwt.verify(token, platformAdminJwtSecret);
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (payload?.role !== 'platform_admin' || !payload?.username) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    // account_role 是这个账号的业务角色(super_admin/sales_manager/sales/customer_service)，
    // 跟上面校验的 role==='platform_admin' 不是一回事——那个只是"这是个平台登录token"的
    // 固定标记，account_role 才是真正决定这个人能看到哪些模块的字段。
    req.platformAdmin = { username: payload.username, role: payload.account_role || 'super_admin' };
    if (req.method !== 'GET') {
      const targetTenantId = req.params?.tenantId || req.body?.tenant_id || req.body?.tenantId || null;
      let detail = {};
      try { detail = JSON.parse(JSON.stringify(req.body || {})); } catch (_) {}
      if (detail && typeof detail === 'object') {
        for (const k of Object.keys(detail)) {
          if (/secret|password|key|token/i.test(k)) detail[k] = '***';
        }
      }
      pool.query(
        `INSERT INTO platform_admin_audit_log (admin_username, method, path, target_tenant_id, detail, ip)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [payload.username, req.method, req.originalUrl, targetTenantId, JSON.stringify(detail).slice(0, 4000), req.ip || '']
      ).catch((e) => console.warn('[platform-admin] audit log write failed:', e?.message));
    }
    next();
  };
}

// 只有 super_admin 能碰租户开通/许可证/系统配置这类"总控"操作。
// 必须放在 platformAdminRequired 之后使用(依赖 req.platformAdmin.role 已经被解出来)。
export function requireSuperAdmin(req, res, next) {
  if (req.platformAdmin?.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden', message: '仅超级管理员可执行此操作' });
  }
  next();
}

// 提成规则设置、KPI目标/主管打分、销售花名册维护这类"销售管理"操作，
// 普通销售/客服不该碰，但销售经理和超级管理员都可以。
export function requireSalesManagerOrAbove(req, res, next) {
  const role = req.platformAdmin?.role;
  if (role !== 'super_admin' && role !== 'sales_manager') {
    return res.status(403).json({ error: 'forbidden', message: '仅销售经理/超级管理员可执行此操作' });
  }
  next();
}

const PLATFORM_ADMIN_ROLES = ['super_admin', 'sales_manager', 'sales', 'customer_service'];

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformRoutes(app, deps) {
  const {
    pool,
    platformAdminRequired,
    loginRateLimit,
    upload,
    recordUploadOwnership,
    PLATFORM_ADMIN_SECRET,
    PLATFORM_ADMIN_JWT_SECRET,
    TENANT_INTEGRATION_ENCRYPTION_KEY,
    REQUIRED_TENANT_FEISHU_TABLE_KEYS,
    invalidateTenantLlmConfigCache,
  } = deps;

  // ── 平台管理员账号：登录 / 一次性bootstrap创建首个账号 / 已登录后创建更多账号 ──
  app.post('/api/admin/auth/bootstrap', async (req, res) => {
    try {
      if (!PLATFORM_ADMIN_SECRET) {
        return res.status(500).json({ error: 'server_config_error', message: 'PLATFORM_ADMIN_SECRET 未配置，无法bootstrap' });
      }
      const provided = String(req.headers['x-platform-admin-secret'] || '').trim();
      if (!provided || provided !== PLATFORM_ADMIN_SECRET) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const existing = await pool.query(`SELECT 1 FROM platform_admins LIMIT 1`);
      if (existing.rows.length > 0) {
        return res.status(403).json({ error: 'already_bootstrapped', message: '已存在平台管理员账号，bootstrap接口已永久失效，请用账号密码登录' });
      }
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '').trim();
      const realName = String(req.body?.real_name || '').trim() || username;
      if (!username || password.length < 8) {
        return res.status(400).json({ error: 'invalid_input', message: 'username必填，password至少8位' });
      }
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO platform_admins (username, password_hash, real_name) VALUES ($1,$2,$3)`,
        [username, hash, realName]
      );
      return res.json({ ok: true, message: '首个平台管理员账号已创建，请用账号密码登录' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/auth/login', loginRateLimit, async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '').trim();
      if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });
      const r = await pool.query(
        `SELECT id, username, password_hash, real_name, status, role FROM platform_admins WHERE lower(username) = lower($1) LIMIT 1`,
        [username]
      );
      const acc = r.rows?.[0];
      if (!acc || acc.status !== 'active') return res.status(401).json({ error: 'invalid_credentials' });
      const ok = await bcrypt.compare(password, String(acc.password_hash || ''));
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
      const accountRole = acc.role || 'super_admin';
      const token = jwt.sign({ username: acc.username, role: 'platform_admin', account_role: accountRole }, PLATFORM_ADMIN_JWT_SECRET, { expiresIn: '12h' });
      await pool.query(`UPDATE platform_admins SET last_login_at = NOW() WHERE id = $1`, [acc.id]).catch(() => {});
      return res.json({ ok: true, token, admin: { username: acc.username, real_name: acc.real_name, role: accountRole } });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  // 创建新账号本身是敏感操作(尤其能创建super_admin)，只有super_admin能做。
  app.post('/api/admin/auth/accounts', platformAdminRequired, requireSuperAdmin, async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '').trim();
      const realName = String(req.body?.real_name || '').trim() || username;
      const role = String(req.body?.role || '').trim();
      if (!username || password.length < 8) {
        return res.status(400).json({ error: 'invalid_input', message: 'username必填，password至少8位' });
      }
      if (!PLATFORM_ADMIN_ROLES.includes(role)) {
        return res.status(400).json({ error: 'invalid_role', message: `role必须是以下之一：${PLATFORM_ADMIN_ROLES.join('、')}` });
      }
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO platform_admins (username, password_hash, real_name, role) VALUES ($1,$2,$3,$4)`,
        [username, hash, realName, role]
      );
      return res.json({ ok: true });
    } catch (e) {
      if (String(e?.message || '').includes('duplicate')) {
        return res.status(409).json({ error: 'username_taken' });
      }
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/auth/accounts', platformAdminRequired, requireSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(`SELECT username, real_name, status, role, created_at, last_login_at FROM platform_admins ORDER BY created_at`);
      return res.json({ ok: true, accounts: r.rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/auth/audit-log', platformAdminRequired, requireSuperAdmin, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query?.limit) || 200, 1000);
      const r = await pool.query(
        `SELECT admin_username, method, path, target_tenant_id, detail, ip, created_at
         FROM platform_admin_audit_log ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      return res.json({ ok: true, items: r.rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });
  function requireTenantIntegrationKey() {
    if (!TENANT_INTEGRATION_ENCRYPTION_KEY) {
      const error = new Error('tenant_integration_encryption_key_missing');
      error.statusCode = 500;
      throw error;
    }
    return TENANT_INTEGRATION_ENCRYPTION_KEY;
  }

  const DEFAULT_PLATFORM_PROFILE = {
    system_name: '年年有喜管理系统',
    page_title: '平台租户控制台',
    logo_url: '',
    favicon_url: '',
    brand_color: '#0d7a5f',
    tagline: '统一管理租户开通、外观配置、飞书接入、自动验收与告警。',
    feature_switches: {
      unified_template: true,
      auto_acceptance: true,
      failure_repair: true,
      tenant_alerts: true,
      billing: true,
      countdown: true,
    },
    billing: {
      plan_name: '',
      billing_cycle: '',
      next_invoice_at: '',
      billing_contact: '',
      billing_contact_method: '',
      notes: '',
    },
    alerts: {
      notify_days_before_expiry: 30,
      feishu_chat: '',
      contact: '',
      notes: '',
    },
    template_switches: {
      hrms: true,
      agent_v2: true,
      mini_program: true,
      feishu: true,
    },
    notes: '',
  };

  function mergePlatformProfile(value, fallbackName = '') {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const featureSwitches = input.feature_switches && typeof input.feature_switches === 'object' && !Array.isArray(input.feature_switches) ? input.feature_switches : {};
    const billing = input.billing && typeof input.billing === 'object' && !Array.isArray(input.billing) ? input.billing : {};
    const alerts = input.alerts && typeof input.alerts === 'object' && !Array.isArray(input.alerts) ? input.alerts : {};
    const templateSwitches = input.template_switches && typeof input.template_switches === 'object' && !Array.isArray(input.template_switches) ? input.template_switches : {};
    return {
      ...DEFAULT_PLATFORM_PROFILE,
      ...input,
      system_name: String(input.system_name || fallbackName || DEFAULT_PLATFORM_PROFILE.system_name).trim() || DEFAULT_PLATFORM_PROFILE.system_name,
      page_title: String(input.page_title || DEFAULT_PLATFORM_PROFILE.page_title).trim() || DEFAULT_PLATFORM_PROFILE.page_title,
      logo_url: String(input.logo_url || '').trim(),
      favicon_url: String(input.favicon_url || '').trim(),
      brand_color: String(input.brand_color || DEFAULT_PLATFORM_PROFILE.brand_color).trim() || DEFAULT_PLATFORM_PROFILE.brand_color,
      tagline: String(input.tagline || DEFAULT_PLATFORM_PROFILE.tagline).trim() || DEFAULT_PLATFORM_PROFILE.tagline,
      notes: String(input.notes || '').trim(),
      feature_switches: {
        ...DEFAULT_PLATFORM_PROFILE.feature_switches,
        ...featureSwitches,
      },
      billing: {
        ...DEFAULT_PLATFORM_PROFILE.billing,
        ...billing,
        plan_name: String(billing.plan_name || '').trim(),
        billing_cycle: String(billing.billing_cycle || '').trim(),
        next_invoice_at: String(billing.next_invoice_at || '').trim(),
        billing_contact: String(billing.billing_contact || '').trim(),
        billing_contact_method: String(billing.billing_contact_method || '').trim(),
        notes: String(billing.notes || '').trim(),
      },
      alerts: {
        ...DEFAULT_PLATFORM_PROFILE.alerts,
        ...alerts,
        notify_days_before_expiry: Number.isFinite(Number(alerts.notify_days_before_expiry))
          ? Math.max(1, Math.floor(Number(alerts.notify_days_before_expiry)))
          : DEFAULT_PLATFORM_PROFILE.alerts.notify_days_before_expiry,
        feishu_chat: String(alerts.feishu_chat || '').trim(),
        contact: String(alerts.contact || '').trim(),
        notes: String(alerts.notes || '').trim(),
      },
      template_switches: {
        ...DEFAULT_PLATFORM_PROFILE.template_switches,
        ...templateSwitches,
      },
    };
  }

  async function getTenantPlatformProfile(db, tenantId, fallbackName = '') {
    const r = await db.query(
      `SELECT config_value
         FROM tenant_config
        WHERE tenant_key = $1 AND config_key = 'platform_profile'
        LIMIT 1`,
      [tenantId]
    );
    return mergePlatformProfile(r.rows?.[0]?.config_value || {}, fallbackName || tenantId);
  }

  async function saveTenantPlatformProfile(db, tenantId, profile) {
    const normalized = mergePlatformProfile(profile, tenantId);
    await db.query(
      `INSERT INTO tenant_config (tenant_key, config_key, config_value)
       VALUES ($1, 'platform_profile', $2::jsonb)
       ON CONFLICT (tenant_key, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [tenantId, JSON.stringify(normalized)]
    );
    return normalized;
  }

  async function getTenantPlatformAcceptanceReport(db, tenantId) {
    const r = await db.query(
      `SELECT config_value
         FROM tenant_config
        WHERE tenant_key = $1 AND config_key = 'platform_acceptance_report'
        LIMIT 1`,
      [tenantId]
    );
    return r.rows?.[0]?.config_value || null;
  }

  async function saveTenantPlatformAcceptanceReport(db, tenantId, report) {
    await db.query(
      `INSERT INTO tenant_config (tenant_key, config_key, config_value)
       VALUES ($1, 'platform_acceptance_report', $2::jsonb)
       ON CONFLICT (tenant_key, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [tenantId, JSON.stringify(report)]
    );
    return report;
  }

  function computeLicenseCountdown(expiresAt) {
    if (!expiresAt) return null;
    const dt = new Date(expiresAt);
    if (!Number.isFinite(dt.getTime())) return null;
    return Math.ceil((dt.getTime() - Date.now()) / 86400000);
  }

  function buildTenantAlerts(tenantRow, licenseRow, profile, feishuSummary) {
    const alerts = [];
    const countdown = computeLicenseCountdown(licenseRow?.license_expires_at || licenseRow?.expires_at);
    if (!licenseRow) {
      alerts.push({ level: 'warn', key: 'license_missing', title: '许可证缺失', detail: '尚未发放许可证。' });
    } else if (Number.isFinite(countdown) && countdown !== null && countdown <= 30) {
      alerts.push({
        level: countdown < 0 ? 'error' : 'warn',
        key: 'license_expiring',
        title: '许可证即将到期',
        detail: countdown < 0 ? '许可证已过期，请立即续期。' : `剩余 ${countdown} 天`,
      });
    }
    if (!feishuSummary?.configured) {
      alerts.push({ level: 'warn', key: 'feishu_missing', title: '飞书未配置', detail: '未绑定独立飞书 Bitable。' });
    }
    if (!String(profile?.system_name || '').trim()) {
      alerts.push({ level: 'warn', key: 'branding_missing', title: '品牌信息未完善', detail: '建议先补系统名称与 Logo。' });
    }
    if (tenantRow?.status !== 'active') {
      alerts.push({ level: 'warn', key: 'tenant_inactive', title: '租户未激活', detail: `当前状态：${tenantRow?.status || '-'}` });
    }
    return alerts;
  }

  async function runTenantAcceptance(tenantId) {
    const tenant = await pool.query(
      `SELECT tenant_id, name, mode, status
         FROM tenants
        WHERE tenant_id = $1
        LIMIT 1`,
      [tenantId]
    );
    if (!tenant.rows.length) {
      return { ok: false, tenant_id: tenantId, checks: [{ key: 'tenant_exists', ok: false, detail: 'tenant_not_found' }] };
    }

    const checks = [];
    const stateRow = await tenantContext.run(tenantId, () => pool.query(`SELECT 1 FROM hrms_state WHERE key = $1 LIMIT 1`, [tenantId]));
    checks.push({ key: 'state_seeded', ok: !!stateRow.rows.length, detail: stateRow.rows.length ? 'ok' : 'missing_hrms_state' });

    const adminRow = await tenantContext.run(tenantId, () => pool.query(
      `SELECT COUNT(*)::int AS count
         FROM users
        WHERE role = 'admin' AND is_active = TRUE`,
      []
    ));
    checks.push({
      key: 'admin_ready',
      ok: Number(adminRow.rows?.[0]?.count || 0) > 0,
      detail: `active_admins=${Number(adminRow.rows?.[0]?.count || 0)}`
    });

    const licenseRow = await pool.query(
      `SELECT status, expires_at
         FROM licenses
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId]
    );
    if (!licenseRow.rows.length) {
      checks.push({ key: 'license_present', ok: false, detail: 'missing_license' });
    } else {
      const license = licenseRow.rows[0];
      const licenseStatus = String(license.status || '').trim().toLowerCase();
      const expiresAt = license.expires_at ? new Date(license.expires_at) : null;
      checks.push({
        key: 'license_present',
        ok: ['active', 'trial'].includes(licenseStatus),
        detail: `status=${licenseStatus || 'unknown'}`
      });
      checks.push({
        key: 'license_not_expired',
        ok: !expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() >= Date.now(),
        detail: license.expires_at || 'no_expiry'
      });
    }

    if (TENANT_INTEGRATION_ENCRYPTION_KEY) {
      const integration = await tenantContext.run(
        tenantId,
        () => getTenantIntegrationSummary(pool, tenantId, 'feishu_bitable', TENANT_INTEGRATION_ENCRYPTION_KEY)
      );
      const configuredTables = Array.isArray(integration.tables) ? integration.tables : [];
      const missingTables = REQUIRED_TENANT_FEISHU_TABLE_KEYS.filter((key) => !configuredTables.includes(key));
      checks.push({
        key: 'feishu_configured',
        ok: !!integration.configured,
        detail: integration.configured ? `tables=${configuredTables.join(',')}` : 'missing_feishu_bitable'
      });
      checks.push({
        key: 'feishu_required_tables',
        ok: !!integration.configured && missingTables.length === 0,
        detail: missingTables.length ? `missing=${missingTables.join(',')}` : 'ok'
      });
    }

    return {
      ok: checks.every((item) => item.ok),
      tenant_id: tenantId,
      tenant: tenant.rows[0],
      checks
    };
  }

  function buildTenantLoginUrl(req, tenantId) {
    const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    const id = encodeURIComponent(String(tenantId || '').trim());
    if (!host) return `/working-fixed.html?tenant_id=${id}`;
    return `${proto}://${host}/working-fixed.html?tenant_id=${id}`;
  }

  async function getTenantPrimaryAdminUsername(poolOrClient, tenantId) {
    const r = await poolOrClient.query(
      `SELECT username FROM users
       WHERE tenant_id = $1 AND role = 'admin' AND is_active = TRUE
       ORDER BY created_at ASC NULLS LAST
       LIMIT 1`,
      [tenantId]
    );
    return String(r.rows[0]?.username || '').trim();
  }

  async function buildTenantLoginAccess(poolOrClient, req, tenantId, { password } = {}) {
    const username = await getTenantPrimaryAdminUsername(poolOrClient, tenantId);
    const access = {
      login_url: buildTenantLoginUrl(req, tenantId),
      tenant_id: tenantId,
      username,
    };
    if (password != null && String(password).length) {
      access.password = String(password);
    } else {
      access.password_hint = '密码为创建租户时设置的值，系统仅存储哈希，无法再次查看';
    }
    return access;
  }
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
      const adminUsername = String(adminReq.username).trim();
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
        acceptance = await runTenantAcceptance(tenantId);
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
        console.warn('[provision] acceptance failed (tenant stays provisioning):', accErr?.message || accErr);
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
    return res.sendFile(path.join(__dirname, '../platform-admin.html'));
  });

  app.get(['/agents-admin', '/agents-admin/'], (req, res) => {
    return res.sendFile(path.join(__dirname, '../agents-admin.html'));
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

  app.post('/api/admin/tenants/:tenantId/license', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const expiresAt = req.body?.expires_at;
    if (!expiresAt) return res.status(400).json({ error: 'missing_expires_at' });
    const allowedFeatures = Array.isArray(req.body?.allowed_features) ? req.body.allowed_features : [];
    const maxStoresRaw = req.body?.max_stores;
    const maxStores = maxStoresRaw == null || maxStoresRaw === '' ? null : Number(maxStoresRaw);
    if (maxStores != null && (!Number.isFinite(maxStores) || maxStores < 0)) {
      return res.status(400).json({ error: 'invalid_max_stores' });
    }
    try {
      const exists = await pool.query('SELECT 1 FROM tenants WHERE tenant_id = $1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const licenseKey = randomUUID();
      const r = await pool.query(
        `INSERT INTO licenses (tenant_id, license_key, expires_at, allowed_features, max_stores)
         VALUES ($1, $2, $3, $4, $5) RETURNING license_key, expires_at, status, max_stores`,
        [tenantId, licenseKey, expiresAt, JSON.stringify(allowedFeatures), maxStores]
      );
      return res.json({ ok: true, license: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/bootstrap', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const exists = await pool.query('SELECT tenant_id, name FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const current = await getTenantPlatformProfile(pool, tenantId, exists.rows[0].name);
      const next = mergePlatformProfile({
        ...current,
        system_name: current.system_name || exists.rows[0].name,
        page_title: current.page_title || `${exists.rows[0].name} 平台控制台`,
        feature_switches: {
          ...current.feature_switches,
          unified_template: true,
          auto_acceptance: true,
          failure_repair: true,
          tenant_alerts: true,
          billing: true,
          countdown: true,
        },
        template_switches: {
          ...current.template_switches,
          hrms: true,
          agent_v2: true,
          mini_program: true,
          feishu: true,
        },
      }, tenantId);
      await saveTenantPlatformProfile(pool, tenantId, next);
      await ensureTenantAgentCenterSeed(tenantId, exists.rows[0].name);
      clearAgentConfigCache();
      const report = await runTenantAcceptance(tenantId);
      await saveTenantPlatformAcceptanceReport(pool, tenantId, {
        ...report,
        checked_at: new Date().toISOString(),
        action: 'bootstrap',
      });
      const login_access = await buildTenantLoginAccess(pool, req, tenantId);
      return res.json({
        ok: true,
        profile: next,
        report,
        message: report.ok ? '初始化完成' : '初始化完成，但部分检查项仍失败',
        login_access,
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/repair', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const exists = await pool.query('SELECT tenant_id FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const profile = await getTenantPlatformProfile(pool, tenantId);
      await saveTenantPlatformProfile(pool, tenantId, profile);
      const report = await runTenantAcceptance(tenantId);
      await saveTenantPlatformAcceptanceReport(pool, tenantId, {
        ...report,
        checked_at: new Date().toISOString(),
        action: 'repair',
      });
      return res.json({
        ok: report.ok,
        report,
        message: report.ok ? '修复校验通过' : '修复校验完成，但仍有检查项失败',
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.get('/api/admin/tenants/:tenantId/integrations/feishu_bitable', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey();
      const summary = await tenantContext.run(
        tenantId,
        () => getTenantIntegrationSummary(pool, tenantId, 'feishu_bitable', key)
      );
      return res.json({ ok: true, integration: summary });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/integrations/feishu_bitable', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey();
      const saved = await tenantContext.run(
        tenantId,
        () => saveTenantFeishuIntegration(pool, tenantId, req.body || {}, key)
      );
      const summary = await tenantContext.run(
        tenantId,
        () => getTenantIntegrationSummary(pool, tenantId, 'feishu_bitable', key)
      );
      return res.json({ ok: true, saved, integration: summary });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  function aiModelConfigPublicView(config) {
    return {
      configured: !!config,
      models: (config?.models || []).map((m) => ({ provider: m.provider, model: m.model, api_key_configured: !!m.api_key })),
    };
  }

  app.get('/api/admin/tenants/:tenantId/integrations/ai_model_config', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey();
      const config = await tenantContext.run(tenantId, () => getTenantAiModelConfig(pool, tenantId, key));
      return res.json({ ok: true, integration: aiModelConfigPublicView(config) });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/integrations/ai_model_config', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey();
      // 每个模型条目的 api_key 留空表示"沿用旧配置里对应位置的密钥"，避免每次调整顺序/加一个模型都要重填所有密钥
      const existing = await tenantContext.run(tenantId, () => getTenantAiModelConfig(pool, tenantId, key)).catch(() => null);
      const body = req.body || {};
      const inputModels = Array.isArray(body.models) ? body.models : [];
      const models = inputModels.map((m, i) => ({
        provider: m?.provider,
        model: m?.model,
        api_key: String(m?.api_key || '').trim() || existing?.models?.[i]?.api_key || '',
      }));
      if (models.length < 2 || models.length > 3) {
        return res.status(400).json({ error: 'invalid_ai_model_config_count', message: '必须配置2-3个模型' });
      }
      await tenantContext.run(tenantId, () => saveTenantAiModelConfig(pool, tenantId, { models }, key));
      if (typeof invalidateTenantLlmConfigCache === 'function') invalidateTenantLlmConfigCache(tenantId);
      const config = await tenantContext.run(tenantId, () => getTenantAiModelConfig(pool, tenantId, key));
      return res.json({ ok: true, integration: aiModelConfigPublicView(config) });
    } catch (e) {
      return res.status(e?.statusCode || (String(e?.message || '').includes('invalid_ai_model_config') ? 400 : 500)).json({ error: e?.message || 'internal_error' });
    }
  });

  // 通用集成配置（飞书对话/小程序/定时任务覆盖）— 复用 tenant_integrations 表，按 integration_key 区分
  const GENERIC_INTEGRATION_KEYS = new Set(['feishu_chat', 'cron_overrides']);

  app.get('/api/admin/tenants/:tenantId/integrations/:integKey', platformAdminRequired, async (req, res) => {
    const { tenantId, integKey } = req.params;
    if (!GENERIC_INTEGRATION_KEYS.has(integKey)) return res.status(404).json({ error: 'unsupported_integration_key' });
    try {
      const key = requireTenantIntegrationKey();
      const config = await tenantContext.run(tenantId, () => getTenantIntegrationConfig(pool, tenantId, integKey, key));
      return res.json({ ok: true, integration: { configured: !!config, ...(config || {}) } });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/integrations/:integKey', platformAdminRequired, async (req, res) => {
    const { tenantId, integKey } = req.params;
    if (!GENERIC_INTEGRATION_KEYS.has(integKey)) return res.status(404).json({ error: 'unsupported_integration_key' });
    try {
      const key = requireTenantIntegrationKey();
      await tenantContext.run(tenantId, () => saveTenantIntegrationConfig(pool, tenantId, integKey, req.body || {}, key));
      const config = await tenantContext.run(tenantId, () => getTenantIntegrationConfig(pool, tenantId, integKey, key));
      return res.json({ ok: true, integration: { configured: !!config, ...(config || {}) } });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/acceptance', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const report = await runTenantAcceptance(tenantId);
      const currentStatus = String(report?.tenant?.status || '').trim().toLowerCase();
      if (report.ok && req.body?.activate !== false) {
        await pool.query(`UPDATE tenants SET status = 'active', updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
        report.tenant = { ...(report.tenant || {}), status: 'active' };
      } else if (!report.ok && currentStatus !== 'active') {
        await pool.query(`UPDATE tenants SET status = 'provisioning', updated_at = NOW() WHERE tenant_id = $1`, [tenantId]);
        report.tenant = { ...(report.tenant || {}), status: 'provisioning' };
      }
      await saveTenantPlatformAcceptanceReport(pool, tenantId, {
        ...report,
        checked_at: new Date().toISOString(),
        action: 'acceptance',
      });
      return res.json({ ok: report.ok, report });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'internal_error' });
    }
  });

  function normalizeAgentModelName(v, fallback = 'qwen-plus') {
    const model = String(v || '').trim();
    if (!model) return fallback;
    return model;
  }

  function normalizeAgentTemperature(v, fallback = 0.1) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(2, Math.round(n * 100) / 100));
  }

  function normalizeAgentScheduleInterval(v, fallback = 30) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.floor(n));
  }

  const PLATFORM_AGENT_DEFAULTS = [
    {
      agent_id: 'master',
      name: 'Master Agent (调度中枢)',
      description: '负责消息路由、任务状态流转和全局上下文管理',
      system_prompt: '你是 HRMS 系统的 Master Agent，负责调度和任务流转。',
      model_name: 'qwen-max',
      temperature: 0.1,
      enabled: true,
      schedule_interval: 1
    },
    {
      agent_id: 'data_auditor',
      name: 'Data Auditor Agent (数据审计)',
      description: '核对来源数据，对异常情况触发预警',
      system_prompt: '你是数据审计 Agent，负责从业务报表和客诉数据中发现异常。',
      model_name: 'qwen-max',
      temperature: 0.1,
      enabled: true,
      schedule_interval: 30
    },
    {
      agent_id: 'ops_supervisor',
      name: 'Ops Agent (营运督导)',
      description: '负责任务分派、到点提醒、以及图片审核',
      system_prompt: '你是营运督导 Agent，负责跟进异常任务的整改并审核照片。',
      model_name: 'qwen-max',
      temperature: 0.2,
      enabled: true,
      schedule_interval: 1
    },
    {
      agent_id: 'sop_advisor',
      name: 'SOP Agent (标准库)',
      description: '管理所有运营标准，提供知识检索',
      system_prompt: '你是 SOP 顾问 Agent，负责解答运营标准相关问题。',
      model_name: 'qwen-max',
      temperature: 0.1,
      enabled: true,
      schedule_interval: 0
    },
    {
      agent_id: 'chief_evaluator',
      name: 'Chief Evaluator (绩效考核)',
      description: '自动计算奖金、评分、评级',
      system_prompt: '你是绩效考核 Agent，负责根据任务解决情况进行扣分和结算。',
      model_name: 'qwen-max',
      temperature: 0.1,
      enabled: true,
      schedule_interval: 60
    },
    {
      agent_id: 'appeal_handler',
      name: 'Appeal Agent (申诉处理)',
      description: '处理员工反馈，核实证据，并支持人工仲裁',
      system_prompt: '你是申诉处理 Agent，负责处理员工对扣分或处罚的异议。',
      model_name: 'qwen-max',
      temperature: 0.2,
      enabled: true,
      schedule_interval: 0
    }
  ];

  const PLATFORM_AGENT_PROMPT_TEMPLATES = [
    { template_key: 'master_default_v1', agent_id: 'master', name: 'Master 默认模板', content: '你是 HRMS 系统的 Master Agent，负责调度和任务流转。', enabled: true, is_builtin: true },
    { template_key: 'data_auditor_default_v1', agent_id: 'data_auditor', name: 'BI 默认模板', content: '你是数据审计 Agent，负责从业务报表和客诉数据中发现异常。', enabled: true, is_builtin: true },
    { template_key: 'ops_supervisor_default_v1', agent_id: 'ops_supervisor', name: 'OP 默认模板', content: '你是营运督导 Agent，负责跟进异常任务的整改并审核照片。', enabled: true, is_builtin: true },
    { template_key: 'sop_advisor_default_v1', agent_id: 'sop_advisor', name: 'SOP 默认模板', content: '你是 SOP 顾问 Agent，负责解答运营标准相关问题。', enabled: true, is_builtin: true },
    { template_key: 'appeal_handler_default_v1', agent_id: 'appeal_handler', name: '申诉 默认模板', content: '你是申诉处理 Agent，负责处理员工对扣分或处罚的异议。', enabled: true, is_builtin: true }
  ];

  const PLATFORM_AGENT_REPLY_TEMPLATES = [
    { template_key: 'reply_master_default_v1', agent_id: 'master', name: 'Master 标准回复', content: '收到，我会立即按优先级分派并跟进处理进度。', enabled: true, is_builtin: true },
    { template_key: 'reply_data_auditor_default_v1', agent_id: 'data_auditor', name: 'BI 异常回复', content: '检测到异常，已生成问题卡片并推送责任人，请在规定时限内整改。', enabled: true, is_builtin: true },
    { template_key: 'reply_ops_supervisor_default_v1', agent_id: 'ops_supervisor', name: 'OP 巡检回复', content: '巡检任务已下发，请按清单逐项完成并回传证明材料。', enabled: true, is_builtin: true },
    { template_key: 'reply_chief_evaluator_default_v1', agent_id: 'chief_evaluator', name: '考核结果回复', content: '本期考核已完成，分数与扣分项已同步，可在绩效页面查看详情。', enabled: true, is_builtin: true }
  ];

  const PLATFORM_AGENT_DEFAULT_COUNTS = {
    configs: PLATFORM_AGENT_DEFAULTS.length,
    prompt_templates: PLATFORM_AGENT_PROMPT_TEMPLATES.length,
    reply_templates: PLATFORM_AGENT_REPLY_TEMPLATES.length
  };

  async function ensureTenantAgentCenterSeed(tenantId, tenantName = '') {
    return tenantContext.run(tenantId, async () => ensureTenantAgentCenterSeedInContext(tenantId, tenantName));
  }

  async function ensureTenantAgentCenterSeedInContext(tenantId, tenantName = '') {
    const seededAt = new Date().toISOString();
    const promptTemplateIds = new Map();
    for (const tpl of PLATFORM_AGENT_PROMPT_TEMPLATES) {
      const r = await pool.query(
        `INSERT INTO agent_prompt_templates (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (template_key, tenant_id)
         DO UPDATE SET name = EXCLUDED.name, content = EXCLUDED.content, enabled = EXCLUDED.enabled, updated_at = NOW()
         RETURNING id, template_key`,
        [tpl.template_key, tpl.agent_id, tpl.name, tpl.content, tpl.enabled !== false, tpl.is_builtin === true, tenantId]
      );
      if (r.rows?.[0]?.template_key && r.rows?.[0]?.id) promptTemplateIds.set(r.rows[0].template_key, r.rows[0].id);
    }

    const replyTemplateIds = new Map();
    for (const tpl of PLATFORM_AGENT_REPLY_TEMPLATES) {
      const r = await pool.query(
        `INSERT INTO agent_reply_templates (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (template_key, tenant_id)
         DO UPDATE SET name = EXCLUDED.name, content = EXCLUDED.content, enabled = EXCLUDED.enabled, updated_at = NOW()
         RETURNING id, template_key`,
        [tpl.template_key, tpl.agent_id, tpl.name, tpl.content, tpl.enabled !== false, tpl.is_builtin === true, tenantId]
      );
      if (r.rows?.[0]?.template_key && r.rows?.[0]?.id) replyTemplateIds.set(r.rows[0].template_key, r.rows[0].id);
    }

    for (const agent of PLATFORM_AGENT_DEFAULTS) {
      const defaultPrompt = PLATFORM_AGENT_PROMPT_TEMPLATES.find((x) => x.agent_id === agent.agent_id);
      const defaultReply = PLATFORM_AGENT_REPLY_TEMPLATES.find((x) => x.agent_id === agent.agent_id);
      const promptTemplateId = defaultPrompt ? (promptTemplateIds.get(defaultPrompt.template_key) || null) : null;
      const replyTemplateId = defaultReply ? (replyTemplateIds.get(defaultReply.template_key) || null) : null;
      await pool.query(
        `INSERT INTO agent_configs (agent_id, name, description, system_prompt, model_name, temperature, enabled, schedule_interval, prompt_template_id, reply_template_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (agent_id, tenant_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           system_prompt = COALESCE(agent_configs.system_prompt, EXCLUDED.system_prompt),
           model_name = COALESCE(agent_configs.model_name, EXCLUDED.model_name),
           temperature = COALESCE(agent_configs.temperature, EXCLUDED.temperature),
           enabled = COALESCE(agent_configs.enabled, EXCLUDED.enabled),
           schedule_interval = COALESCE(agent_configs.schedule_interval, EXCLUDED.schedule_interval),
           prompt_template_id = COALESCE(agent_configs.prompt_template_id, EXCLUDED.prompt_template_id),
           reply_template_id = COALESCE(agent_configs.reply_template_id, EXCLUDED.reply_template_id),
           updated_at = NOW()`,
        [agent.agent_id, agent.name, agent.description, agent.system_prompt, agent.model_name, agent.temperature, agent.enabled, agent.schedule_interval, promptTemplateId, replyTemplateId, tenantId]
      );
    }

    await pool.query(
      `INSERT INTO tenant_config (tenant_key, config_key, config_value)
       VALUES ($1, 'platform_agent_center_seed', $2::jsonb)
       ON CONFLICT (tenant_key, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [tenantId, JSON.stringify({ tenant_id: tenantId, tenant_name: tenantName || tenantId, seeded_at: seededAt })]
    );
  }

  async function loadTenantAgentCenterData(tenantId) {
    return tenantContext.run(tenantId, async () => loadTenantAgentCenterDataInContext(tenantId));
  }

  async function loadTenantAgentCenterDataInContext(tenantId) {
    const configs = await pool.query(
      `SELECT c.*, t.name AS prompt_template_name, rt.name AS reply_template_name
         FROM agent_configs c
    LEFT JOIN agent_prompt_templates t ON c.prompt_template_id = t.id
    LEFT JOIN agent_reply_templates rt ON c.reply_template_id = rt.id
        WHERE c.tenant_id = $1
        ORDER BY c.agent_id`,
      [tenantId]
    );
    const promptTemplates = await pool.query(
      `SELECT *
         FROM agent_prompt_templates
        WHERE tenant_id = $1
        ORDER BY agent_id, is_builtin DESC, updated_at DESC`,
      [tenantId]
    );
    const replyTemplates = await pool.query(
      `SELECT *
         FROM agent_reply_templates
        WHERE tenant_id = $1
        ORDER BY agent_id, is_builtin DESC, updated_at DESC`,
      [tenantId]
    );
    const roleModules = await pool.query(
      `SELECT config
         FROM hr_rating_configs
        WHERE config_key = 'role_module_config'
          AND tenant_id = $1
          AND enabled = true
        LIMIT 1`,
      [tenantId]
    ).catch(() => ({ rows: [] }));
    return {
      configs: configs.rows || [],
      prompt_templates: promptTemplates.rows || [],
      reply_templates: replyTemplates.rows || [],
      role_modules: roleModules.rows?.[0]?.config || null
    };
  }

  async function ensureTenantAgentCenterReady(tenantId, tenantName = '') {
    const current = await loadTenantAgentCenterData(tenantId);
    const shouldSeed =
      current.configs.length < PLATFORM_AGENT_DEFAULT_COUNTS.configs
      || current.prompt_templates.length < PLATFORM_AGENT_DEFAULT_COUNTS.prompt_templates
      || current.reply_templates.length < PLATFORM_AGENT_DEFAULT_COUNTS.reply_templates;
    if (!shouldSeed) {
      return { ...current, seeded: false };
    }
    await ensureTenantAgentCenterSeed(tenantId, tenantName);
    const reloaded = await loadTenantAgentCenterData(tenantId);
    return { ...reloaded, seeded: true };
  }

  app.get('/api/admin/tenants/:tenantId/agent-center', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'missing_tenant_id' });
    try {
      const exists = await pool.query('SELECT tenant_id, name FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!exists.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const data = await ensureTenantAgentCenterReady(tenantId, exists.rows[0].name);
      return res.json({
        ok: true,
        tenant: exists.rows[0],
        ...data,
        summary: {
          configs: data.configs.length,
          prompt_templates: data.prompt_templates.length,
          reply_templates: data.reply_templates.length,
          enabled_configs: data.configs.filter((row) => row.enabled !== false).length,
        }
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/agent-center/configs/:agentId', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const agentId = String(req.params.agentId || '').trim();
    if (!tenantId || !agentId) return res.status(400).json({ error: 'missing_params' });
    try {
      const existing = await pool.query(
        `SELECT *
           FROM agent_configs
          WHERE tenant_id = $1 AND agent_id = $2
          LIMIT 1`,
        [tenantId, agentId]
      );
      if (!existing.rows.length) return res.status(404).json({ error: 'config_not_found' });
      const body = req.body || {};
      const nextSystemPrompt = Object.prototype.hasOwnProperty.call(body, 'system_prompt')
        ? String(body.system_prompt || '').trim()
        : existing.rows[0].system_prompt || '';
      const hasPromptTemplateId = Object.prototype.hasOwnProperty.call(body, 'prompt_template_id');
      const hasReplyTemplateId = Object.prototype.hasOwnProperty.call(body, 'reply_template_id');
      const promptTemplateId = hasPromptTemplateId ? (String(body.prompt_template_id || '').trim() || null) : existing.rows[0].prompt_template_id || null;
      const replyTemplateId = hasReplyTemplateId ? (String(body.reply_template_id || '').trim() || null) : existing.rows[0].reply_template_id || null;
      const r = await pool.query(
        `UPDATE agent_configs
            SET system_prompt = $1,
                model_name = $2,
                temperature = $3,
                enabled = $4,
                schedule_interval = $5,
                prompt_template_id = $6,
                reply_template_id = $7,
                updated_at = NOW()
          WHERE tenant_id = $8 AND agent_id = $9
          RETURNING *`,
        [
          nextSystemPrompt,
          normalizeAgentModelName(body.model_name, existing.rows[0].model_name || 'qwen-plus'),
          normalizeAgentTemperature(body.temperature, Number(existing.rows[0].temperature ?? 0.1)),
          body.enabled === undefined ? !!existing.rows[0].enabled : !!body.enabled,
          normalizeAgentScheduleInterval(body.schedule_interval, Number(existing.rows[0].schedule_interval ?? 30)),
          promptTemplateId,
          replyTemplateId,
          tenantId,
          agentId
        ]
      );
      clearAgentConfigCache();
      return res.json({ ok: true, config: r.rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
    }
  });

  async function createTenantAgentTemplate(kind, tenantId, body) {
    const agentId = String(body?.agent_id || '').trim();
    const name = String(body?.name || '').trim();
    const content = String(body?.content || '').trim();
    const enabled = body?.enabled !== false;
    if (!agentId || !name || !content) {
      const err = new Error('missing_params');
      err.statusCode = 400;
      throw err;
    }
    const keyPrefix = kind === 'reply' ? 'tenant_reply' : 'tenant_prompt';
    const table = kind === 'reply' ? 'agent_reply_templates' : 'agent_prompt_templates';
    const key = `${keyPrefix}_${agentId}_${Date.now()}`;
    const r = await pool.query(
      `INSERT INTO ${table} (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       RETURNING *`,
      [key, agentId, name, content, enabled, tenantId]
    );
    return r.rows[0];
  }

  async function updateTenantAgentTemplate(kind, tenantId, id, body) {
    const table = kind === 'reply' ? 'agent_reply_templates' : 'agent_prompt_templates';
    const old = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
    if (!old.rows?.length) {
      const err = new Error('template_not_found');
      err.statusCode = 404;
      throw err;
    }
    const row = old.rows[0];
    const name = String(body?.name ?? row.name).trim() || row.name;
    const enabled = body?.enabled === undefined ? !!row.enabled : !!body.enabled;
    if (row.is_builtin) {
      const r = await pool.query(
        `UPDATE ${table} SET name = $1, enabled = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4 RETURNING *`,
        [name, enabled, id, tenantId]
      );
      return { template: r.rows[0], locked_content: true };
    }
    const content = String(body?.content ?? row.content).trim() || row.content;
    const r = await pool.query(
      `UPDATE ${table} SET name = $1, content = $2, enabled = $3, updated_at = NOW() WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [name, content, enabled, id, tenantId]
    );
    return { template: r.rows[0] };
  }

  async function deleteTenantAgentTemplate(kind, tenantId, id) {
    const table = kind === 'reply' ? 'agent_reply_templates' : 'agent_prompt_templates';
    const old = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [id, tenantId]);
    if (!old.rows?.length) {
      const err = new Error('template_not_found');
      err.statusCode = 404;
      throw err;
    }
    if (old.rows[0].is_builtin) {
      const err = new Error('builtin_template_cannot_delete');
      err.statusCode = 400;
      throw err;
    }
    const usedTable = kind === 'reply' ? 'reply_template_id' : 'prompt_template_id';
    const used = await pool.query(`SELECT COUNT(*)::int AS c FROM agent_configs WHERE ${usedTable} = $1 AND tenant_id = $2`, [id, tenantId]);
    if (Number(used.rows?.[0]?.c || 0) > 0) {
      const err = new Error('template_in_use');
      err.statusCode = 400;
      throw err;
    }
    await pool.query(`DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    return { ok: true };
  }

  app.post('/api/admin/tenants/:tenantId/agent-center/templates/prompt', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const template = await createTenantAgentTemplate('prompt', tenantId, req.body || {});
      clearAgentConfigCache();
      return res.json({ ok: true, template });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/agent-center/templates/prompt/:id', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const id = String(req.params.id || '').trim();
    try {
      const result = await updateTenantAgentTemplate('prompt', tenantId, id, req.body || {});
      clearAgentConfigCache();
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.delete('/api/admin/tenants/:tenantId/agent-center/templates/prompt/:id', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const id = String(req.params.id || '').trim();
    try {
      const result = await deleteTenantAgentTemplate('prompt', tenantId, id);
      clearAgentConfigCache();
      return res.json(result);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.post('/api/admin/tenants/:tenantId/agent-center/templates/reply', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const template = await createTenantAgentTemplate('reply', tenantId, req.body || {});
      clearAgentConfigCache();
      return res.json({ ok: true, template });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/agent-center/templates/reply/:id', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const id = String(req.params.id || '').trim();
    try {
      const result = await updateTenantAgentTemplate('reply', tenantId, id, req.body || {});
      clearAgentConfigCache();
      return res.json({ ok: true, ...result });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  app.delete('/api/admin/tenants/:tenantId/agent-center/templates/reply/:id', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    const id = String(req.params.id || '').trim();
    try {
      const result = await deleteTenantAgentTemplate('reply', tenantId, id);
      clearAgentConfigCache();
      return res.json(result);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ error: e.message || 'internal_error' });
    }
  });

  // 托管控制台（agents-admin）专用：按 tenantId 路径参数读取门店列表，不依赖登录租户的 JWT。
  app.get('/api/admin/tenants/:tenantId/stores', platformAdminRequired, async (req, res) => {
    try {
      const r = await pool.query('select data from hrms_state where key = $1 limit 1', [req.params.tenantId || 'default']);
      const row = r.rows?.[0] || null;
      const stateStores = Array.isArray(row?.data?.stores) ? row.data.stores : [];
      const items = stateStores.map(s => ({ id: s.id || s.name, name: s.name }));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

}
