/**
 * Platform tenant admin routes (extracted from index.js — phase H).
 * registerTenantPlatformRoutes(app, deps) — behavior-preserving move.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import { SYSTEM_TENANT_ID, tenantContext } from './utils/database.js';
import { createEmptyTenantState } from './tenant-login.js';
import {
  getTenantIntegrationSummary,
  saveTenantFeishuIntegration,
  getTenantIntegrationConfig,
  saveTenantIntegrationConfig,
  getTenantAiModelConfig,
  saveTenantAiModelConfig,
  getTenantFeishuBotIntegration,
  saveTenantFeishuBotIntegration,
  feishuBotIntegrationPublicSummary,
} from './tenant-integrations.js';
import { clearAgentConfigCache } from './agent-config-manager.js';
import { resetLarkTenantTokenCache } from './feishu-messaging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPlatformAdminRequired(pool, platformAdminJwtSecret) {
  return async function platformAdminRequired(req, res, next) {
    const nextInSystemContext = () => tenantContext.run(SYSTEM_TENANT_ID, () => next());
    if (req.platformAdmin?.username) return nextInSystemContext();
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
    // account_role 是这个账号的业务角色(super_admin/general_manager/sales_manager/sales/customer_service/finance/implementation)，
    // 跟上面校验的 role==='platform_admin' 不是一回事——那个只是"这是个平台登录token"的
    // 固定标记，account_role 才是真正决定这个人能看到哪些模块的字段。
    req.platformAdmin = { username: payload.username, role: payload.account_role || 'super_admin' };
    const controlPlaneOnly = ['/api/admin/tenants', '/api/admin/health-center', '/api/admin/auth/accounts'];
    if (req.platformAdmin.role !== 'super_admin' && controlPlaneOnly.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      return res.status(403).json({ error: 'forbidden', message: '该账号无权查看平台租户总控信息' });
    }
    if (req.platformAdmin.role === 'auditor' && req.method !== 'GET') {
      return res.status(403).json({ error: 'forbidden', message: '只读审计账号不能执行修改操作' });
    }
    if (req.method !== 'GET') {
      const targetTenantId = req.params?.tenantId || req.body?.tenant_id || req.body?.tenantId || null;
      let detail = {};
      try { detail = JSON.parse(JSON.stringify(req.body || { /* ignore */ })); } catch (_) {}
      if (detail && typeof detail === 'object') {
        for (const k of Object.keys(detail)) {
          if (/secret|password|key|token/i.test(k)) detail[k] = '***';
        }
      }
      tenantContext.run(SYSTEM_TENANT_ID, () => pool.query(
        `INSERT INTO platform_admin_audit_log (admin_username, method, path, target_tenant_id, detail, ip)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [payload.username, req.method, req.originalUrl, targetTenantId, JSON.stringify(detail).slice(0, 4000), req.ip || '']
      )).catch((e) => console.warn('[platform-admin] audit log write failed:', e?.message));
    }
    return nextInSystemContext();
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
  if (!['super_admin', 'general_manager', 'sales_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden', message: '仅总经理、销售经理或超级管理员可执行此操作' });
  }
  next();
}

const PLATFORM_ADMIN_ROLES = ['super_admin', 'general_manager', 'sales_manager', 'sales', 'customer_service', 'finance', 'implementation', 'auditor'];

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformRoutes(app, deps) {
  const {
    pool,
    platformAdminRequired,
    platformAdminSessionRequired = platformAdminRequired,
    loginRateLimit,
    upload,
    recordUploadOwnership,
    PLATFORM_ADMIN_SECRET,
    PLATFORM_ADMIN_JWT_SECRET,
    TENANT_INTEGRATION_ENCRYPTION_KEY,
    REQUIRED_TENANT_FEISHU_TABLE_KEYS,
    invalidateTenantLlmConfigCache,
  } = deps;

  app.get(['/sales-crm', '/sales-crm/'], (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'platform-admin.html'));
  });

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

  app.get('/api/admin/auth/audit-log', platformAdminSessionRequired, async (req, res) => {
    try {
      if (!['super_admin', 'auditor'].includes(req.platformAdmin?.role)) {
        return res.status(403).json({ error: 'forbidden', message: '仅超级管理员或只读审计人员可查看审计日志' });
      }
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
      // 账单/发票送达方式与联系方式——目前只存这些信息、供人工下载账单后手动发送；
      // 自动发送(邮件/微信)是后续需求，这里先把数据结构和录入入口做好。
      delivery_method: 'email',
      billing_contact_email: '',
      billing_contact_wechat: '',
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
        delivery_method: ['email', 'wechat'].includes(String(billing.delivery_method || '').trim())
          ? String(billing.delivery_method).trim()
          : DEFAULT_PLATFORM_PROFILE.billing.delivery_method,
        billing_contact_email: String(billing.billing_contact_email || '').trim(),
        billing_contact_wechat: String(billing.billing_contact_wechat || '').trim(),
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

  // 我方收款账户——平台级单一配置，不按租户区分，复用tenant_config表但用'__system__'
  // 这个哨兵tenant_key(该表对tenant_key没有外键约束，不会因为不是真实tenant_id而报错)。
  const PLATFORM_BILLING_ACCOUNT_KEY = '__system__';
  const DEFAULT_BILLING_ACCOUNT = {
    account_name: '', bank_name: '', bank_branch: '', bank_account_no: '',
    wechat_qr_url: '', alipay_qr_url: '', notes: '',
  };
  async function getPlatformBillingAccount(db) {
    const r = await db.query(
      `SELECT config_value FROM tenant_config WHERE tenant_key = $1 AND config_key = 'billing_account' LIMIT 1`,
      [PLATFORM_BILLING_ACCOUNT_KEY]
    );
    return { ...DEFAULT_BILLING_ACCOUNT, ...(r.rows?.[0]?.config_value || {}) };
  }
  async function savePlatformBillingAccount(db, account) {
    const normalized = {
      account_name: String(account?.account_name || '').trim(),
      bank_name: String(account?.bank_name || '').trim(),
      bank_branch: String(account?.bank_branch || '').trim(),
      bank_account_no: String(account?.bank_account_no || '').trim(),
      wechat_qr_url: String(account?.wechat_qr_url || '').trim(),
      alipay_qr_url: String(account?.alipay_qr_url || '').trim(),
      notes: String(account?.notes || '').trim(),
    };
    await db.query(
      `INSERT INTO tenant_config (tenant_key, config_key, config_value)
       VALUES ($1, 'billing_account', $2::jsonb)
       ON CONFLICT (tenant_key, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [PLATFORM_BILLING_ACCOUNT_KEY, JSON.stringify(normalized)]
    );
    return normalized;
  }

  // 收款账户信息跟签约价格一样敏感，只对超级管理员/总经理/财务开放编辑；
  // 下载账单本身(会带出这份信息)仍按现有platformAdminRequired口径开放给
  // 需要把账单发给客户的销售/客服——机密的是"能不能改"，不是"账单上能不能看见"。
  const billingAccountGate = (req, res, next) => {
    if (!['super_admin', 'general_manager', 'finance'].includes(req.platformAdmin?.role)) {
      return res.status(403).json({ error: 'forbidden', message: '仅超级管理员/总经理/财务可查看或修改收款账户' });
    }
    next();
  };

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

  // 账单PDF下载——现在只做"生成可下载文件"这一步，不做自动发送；销售/客服下载后
  // 自行通过邮箱/微信手动发给客户。内容来自platform_profile.billing这个已有的配置对象，
  // 不需要新表；只是把已经录入的账单计划/周期/联系人信息渲染成一份能给客户看的PDF。
  //
  // 中文字体：pdfkit内置字体(Helvetica等)不含中文字形，直接doc.text()写中文会变成乱码方框——
  // 这是上线后被发现的真实bug，不是假设性风险。必须显式注册一个含中文字形的TrueType字体
  // (server/assets/fonts/NotoSansSC-*.ttf，OFL开源协议，可随仓库分发)。用doc.font()指定字体名
  // 而不是每次都传完整路径，方便下面在常规/粗体之间切换。
  const BILLING_FONT_REGULAR = path.join(__dirname, 'assets/fonts/NotoSansSC-Regular.ttf');
  const BILLING_FONT_BOLD = path.join(__dirname, 'assets/fonts/NotoSansSC-Bold.ttf');

  app.get('/api/admin/platform/billing-account', platformAdminRequired, billingAccountGate, async (_req, res) => {
    try {
      res.json({ ok: true, account: await getPlatformBillingAccount(pool) });
    } catch (e) { res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' }); }
  });

  app.put('/api/admin/platform/billing-account', platformAdminRequired, billingAccountGate, async (req, res) => {
    try {
      const saved = await savePlatformBillingAccount(pool, req.body?.account || req.body || {});
      res.json({ ok: true, account: saved });
    } catch (e) { res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' }); }
  });

  const BILLING_CYCLE_LABELS = { monthly: '按月', quarterly: '按季', yearly: '按年' };
  // 账期起点=下次开票日期往前推一个周期。这个日期是平台配置页里人工维护的"下次开票"，
  // 不是凭空计算的——账期准确性依赖这个字段被及时维护，PDF只负责把它换算成一个区间展示。
  function computeBillingPeriod(nextInvoiceAt, cycle) {
    const end = nextInvoiceAt ? new Date(nextInvoiceAt) : null;
    if (!end || Number.isNaN(end.getTime())) return null;
    const start = new Date(end);
    if (cycle === 'quarterly') start.setMonth(start.getMonth() - 3);
    else if (cycle === 'yearly') start.setFullYear(start.getFullYear() - 1);
    else start.setMonth(start.getMonth() - 1); // monthly 或未设置时的默认假设
    return { start, end };
  }

  app.get('/api/admin/tenants/:tenantId/billing/pdf', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const tenantRow = await pool.query('SELECT name FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!tenantRow.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const profile = await getTenantPlatformProfile(pool, tenantId, tenantRow.rows[0].name);
      const billing = profile.billing || {};
      const tenantName = tenantRow.rows[0].name || tenantId;
      const brandColor = /^#[0-9a-fA-F]{6}$/.test(profile.brand_color || '') ? profile.brand_color : '#0d7a5f';
      const fmtDate = (v) => {
        if (!v) return '未配置';
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
      };

      // 签约价格/账期是sales_leads上的机密字段，权威来源只有这一个，不能让账单金额跟
      // platform_profile.billing里那个自由文本的账单计划/周期各说各话、对不上账。
      const leadRow = await pool.query(
        `SELECT id, contract_price_fen, contract_billing_cycle, contract_billing_day
           FROM sales_leads WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
        [tenantId]
      );
      const lead = leadRow.rows?.[0] || null;
      const hasContractPrice = lead && Number(lead.contract_price_fen) > 0;
      const period = hasContractPrice ? computeBillingPeriod(billing.next_invoice_at, lead.contract_billing_cycle) : null;
      const billingAccount = await getPlatformBillingAccount(pool);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="billing-${tenantId}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      doc.registerFont('cn', BILLING_FONT_REGULAR);
      doc.registerFont('cn-bold', BILLING_FONT_BOLD);
      doc.pipe(res);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // 顶部品牌条 + 标题
      doc.rect(doc.page.margins.left, doc.page.margins.top, pageWidth, 4).fill(brandColor);
      doc.moveDown(1.2);
      doc.font('cn-bold').fontSize(20).fillColor('#1a1a1a').text(tenantName);
      doc.font('cn').fontSize(11).fillColor('#666').text('账单 / Billing Statement');
      doc.moveDown(1);

      // 分隔线
      const hr = () => {
        const y = doc.y;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor('#e0dcd3').lineWidth(1).stroke();
        doc.moveDown(0.8);
      };
      hr();

      // 本期账单金额——放在最显眼的位置，金额只来自sales_leads的机密字段，
      // 没配置就明确写"未设置"，绝不编造一个数字。
      const amountBoxY = doc.y;
      doc.rect(doc.page.margins.left, amountBoxY, pageWidth, 64).fill('#f7f4ee');
      doc.font('cn').fontSize(9).fillColor('#999').text('本期账单金额', doc.page.margins.left + 16, amountBoxY + 10);
      if (hasContractPrice) {
        doc.font('cn-bold').fontSize(22).fillColor(brandColor).text(
          `¥ ${(Number(lead.contract_price_fen) / 100).toFixed(2)}`,
          doc.page.margins.left + 16, amountBoxY + 24
        );
        if (period) {
          doc.font('cn').fontSize(9).fillColor('#666').text(
            `账期：${period.start.toISOString().slice(0, 10)} 至 ${period.end.toISOString().slice(0, 10)}（${BILLING_CYCLE_LABELS[lead.contract_billing_cycle] || ''}）`,
            doc.page.margins.left + 200, amountBoxY + 32
          );
        }
      } else {
        doc.font('cn-bold').fontSize(13).fillColor('#a15c00').text(
          '未设置签约价格，请联系总经理/财务在客户档案中补充后再发送本账单',
          doc.page.margins.left + 16, amountBoxY + 28, { width: pageWidth - 32 }
        );
      }
      doc.y = amountBoxY + 64 + 16;
      hr();

      // 两列信息区：左边租户/计划信息，右边联系与送达信息
      const colGap = 24;
      const colWidth = (pageWidth - colGap) / 2;
      const leftX = doc.page.margins.left;
      const rightX = leftX + colWidth + colGap;
      const topY = doc.y;

      const field = (x, y, label, value) => {
        doc.font('cn').fontSize(9).fillColor('#999').text(label, x, y);
        doc.font('cn').fontSize(12).fillColor('#1a1a1a').text(value || '未配置', x, y + 13, { width: colWidth });
      };

      field(leftX, topY, '租户编号', tenantId);
      field(leftX, topY + 46, '账单计划', billing.plan_name);
      field(leftX, topY + 92, '账单周期', billing.billing_cycle);
      field(leftX, topY + 138, '下次开票日期', fmtDate(billing.next_invoice_at));

      field(rightX, topY, '账单联系人', billing.billing_contact);
      field(rightX, topY + 46, '联系人邮箱', billing.billing_contact_email);
      field(rightX, topY + 92, '联系人微信', billing.billing_contact_wechat);
      field(rightX, topY + 138, '送达方式', billing.delivery_method === 'wechat' ? '微信' : '邮箱');

      doc.y = topY + 138 + 40;
      hr();

      // 收款账户——只要平台管理员填过其中一项就展示，避免全空时还打印一堆"未配置"的表格。
      const hasBillingAccount = billingAccount.account_name || billingAccount.bank_account_no || billingAccount.bank_name;
      if (hasBillingAccount) {
        doc.font('cn-bold').fontSize(10).fillColor('#1a1a1a').text('收款账户信息');
        doc.moveDown(0.4);
        const acctTopY = doc.y;
        field(leftX, acctTopY, '收款单位', billingAccount.account_name);
        field(leftX, acctTopY + 46, '开户行', billingAccount.bank_name + (billingAccount.bank_branch ? `（${billingAccount.bank_branch}）` : ''));
        field(rightX, acctTopY, '银行账号', billingAccount.bank_account_no);
        doc.y = acctTopY + 46 + 40;
        hr();
      }

      if (billing.notes) {
        doc.font('cn-bold').fontSize(10).fillColor('#1a1a1a').text('备注');
        doc.moveDown(0.3);
        doc.font('cn').fontSize(10).fillColor('#444').text(billing.notes, { width: pageWidth });
        doc.moveDown(1);
        hr();
      }

      doc.font('cn').fontSize(9).fillColor('#999');
      doc.text(`生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
      doc.text('本账单由平台系统自动生成');

      doc.end();
    } catch (e) {
      if (!res.headersSent) return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
      res.end();
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

  // 租户自己的飞书消息机器人应用(app_id/app_secret)——用于 sendLarkMessage/sendLarkCard 按租户
  // 使用各自的飞书自建应用身份发消息，而不是永远用平台全局 LARK_APP_ID。跟 feishu_bitable(多维表格
  // 同步用)是两个独立配置。未配置时 getLarkTenantToken 回退到全局应用，兼容未做迁移的老租户。
  app.get('/api/admin/tenants/:tenantId/integrations/feishu_bot', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey();
      const config = await tenantContext.run(tenantId, () => getTenantFeishuBotIntegration(pool, tenantId, key));
      return res.json({ ok: true, integration: feishuBotIntegrationPublicSummary(config) });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/integrations/feishu_bot', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey();
      const saved = await tenantContext.run(tenantId, () => saveTenantFeishuBotIntegration(pool, tenantId, req.body || {}, key));
      resetLarkTenantTokenCache(tenantId);
      const config = await tenantContext.run(tenantId, () => getTenantFeishuBotIntegration(pool, tenantId, key));
      return res.json({ ok: true, saved, integration: feishuBotIntegrationPublicSummary(config) });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  // 通用集成配置（飞书对话/定时任务覆盖）— 复用 tenant_integrations 表，按 integration_key 区分
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
