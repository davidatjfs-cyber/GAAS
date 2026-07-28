import path from 'path';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { tenantContext } from '../../utils/database.js';
import { getTenantIntegrationSummary } from '../../tenant-integrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to `server/` */
export const SERVER_ROOT = path.join(__dirname, '../..');

/** Repository root (parent of `server/`) */
export const REPO_ROOT = path.join(SERVER_ROOT, '..');

export function platformAdminHtmlPath() {
  return path.join(REPO_ROOT, 'platform-admin.html');
}

export function agentsAdminHtmlPath() {
  return path.join(REPO_ROOT, 'agents-admin.html');
}

export function billingFontRegularPath() {
  return path.join(SERVER_ROOT, 'assets/fonts/NotoSansSC-Regular.ttf');
}

export function billingFontBoldPath() {
  return path.join(SERVER_ROOT, 'assets/fonts/NotoSansSC-Bold.ttf');
}

export function requireTenantIntegrationKey(encryptionKey) {
  if (!encryptionKey) {
    const error = new Error('tenant_integration_encryption_key_missing');
    error.statusCode = 500;
    throw error;
  }
  return encryptionKey;
}

export const DEFAULT_PLATFORM_PROFILE = {
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

export function mergePlatformProfile(value, fallbackName = '') {
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

export async function getTenantPlatformProfile(db, tenantId, fallbackName = '') {
  const r = await db.query(
    `SELECT config_value
         FROM tenant_config
        WHERE tenant_key = $1 AND config_key = 'platform_profile'
        LIMIT 1`,
    [tenantId]
  );
  return mergePlatformProfile(r.rows?.[0]?.config_value || {}, fallbackName || tenantId);
}

export async function saveTenantPlatformProfile(db, tenantId, profile) {
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
export const PLATFORM_BILLING_ACCOUNT_KEY = '__system__';
export const DEFAULT_BILLING_ACCOUNT = {
  account_name: '', bank_name: '', bank_branch: '', bank_account_no: '',
  wechat_qr_url: '', alipay_qr_url: '', notes: '',
};

export async function getPlatformBillingAccount(db) {
  const r = await db.query(
    `SELECT config_value FROM tenant_config WHERE tenant_key = $1 AND config_key = 'billing_account' LIMIT 1`,
    [PLATFORM_BILLING_ACCOUNT_KEY]
  );
  return { ...DEFAULT_BILLING_ACCOUNT, ...(r.rows?.[0]?.config_value || {}) };
}

export async function savePlatformBillingAccount(db, account) {
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
export function billingAccountGate(req, res, next) {
  if (!['super_admin', 'general_manager', 'finance'].includes(req.platformAdmin?.role)) {
    return res.status(403).json({ error: 'forbidden', message: '仅超级管理员/总经理/财务可查看或修改收款账户' });
  }
  next();
}

export async function getTenantPlatformAcceptanceReport(db, tenantId) {
  const r = await db.query(
    `SELECT config_value
         FROM tenant_config
        WHERE tenant_key = $1 AND config_key = 'platform_acceptance_report'
        LIMIT 1`,
    [tenantId]
  );
  return r.rows?.[0]?.config_value || null;
}

export async function saveTenantPlatformAcceptanceReport(db, tenantId, report) {
  await db.query(
    `INSERT INTO tenant_config (tenant_key, config_key, config_value)
       VALUES ($1, 'platform_acceptance_report', $2::jsonb)
       ON CONFLICT (tenant_key, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
    [tenantId, JSON.stringify(report)]
  );
  return report;
}

export function computeLicenseCountdown(expiresAt) {
  if (!expiresAt) return null;
  const dt = new Date(expiresAt);
  if (!Number.isFinite(dt.getTime())) return null;
  return Math.ceil((dt.getTime() - Date.now()) / 86400000);
}

export function buildTenantAlerts(tenantRow, licenseRow, profile, feishuSummary) {
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

export async function runTenantAcceptance(pool, tenantId, { tenantIntegrationEncryptionKey, requiredTenantFeishuTableKeys }) {
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

  if (tenantIntegrationEncryptionKey) {
    const integration = await tenantContext.run(
      tenantId,
      () => getTenantIntegrationSummary(pool, tenantId, 'feishu_bitable', tenantIntegrationEncryptionKey)
    );
    const configuredTables = Array.isArray(integration.tables) ? integration.tables : [];
    const missingTables = requiredTenantFeishuTableKeys.filter((key) => !configuredTables.includes(key));
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

export function buildTenantLoginUrl(req, tenantId) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const id = encodeURIComponent(String(tenantId || '').trim());
  if (!host) return `/working-fixed.html?tenant_id=${id}`;
  return `${proto}://${host}/working-fixed.html?tenant_id=${id}`;
}

export async function getTenantPrimaryAdminUsername(poolOrClient, tenantId) {
  const r = await poolOrClient.query(
    `SELECT username FROM users
       WHERE tenant_id = $1 AND role = 'admin' AND is_active = TRUE
       ORDER BY created_at ASC NULLS LAST
       LIMIT 1`,
    [tenantId]
  );
  return String(r.rows[0]?.username || '').trim();
}

export async function buildTenantLoginAccess(poolOrClient, req, tenantId, { password } = {}) {
  const username = await getTenantPrimaryAdminUsername(poolOrClient, tenantId);
  const access = {
    login_url: buildTenantLoginUrl(req, tenantId),
    tenant_id: tenantId,
    username,
  };
  if (password != null && String(password).length) {
    access.password = String(password);
  } else {
    access.password_hint = '密码为创建租户时设置的值，系统仅存储哈希，无法再次查看；可使用「重置管理员密码」生成新临时密码';
  }
  return access;
}

/** 生成符合登录强度要求的临时密码（字母+数字，≥8 位） */
export function generateTenantAdminTempPassword() {
  return `Gaas${randomBytes(4).toString('hex')}!`;
}

/**
 * 重置租户主管理员密码。明文仅本次返回，库内只存哈希。
 */
export async function resetTenantAdminPassword(poolOrClient, tenantId, { password } = {}) {
  const tid = String(tenantId || '').trim();
  if (!tid) return { ok: false, status: 400, error: 'missing_tenant_id' };
  const username = await getTenantPrimaryAdminUsername(poolOrClient, tid);
  if (!username) return { ok: false, status: 404, error: 'admin_not_found', message: '该租户没有可用的管理员账号' };
  const tempPassword = String(password || '').trim() || generateTenantAdminTempPassword();
  if (tempPassword.length < 8 || !/[A-Za-z]/.test(tempPassword) || !/[0-9]/.test(tempPassword)) {
    return { ok: false, status: 400, error: 'weak_password', message: '新密码至少8位，且需同时包含字母和数字' };
  }
  const hash = await bcrypt.hash(tempPassword, 10);
  const r = await poolOrClient.query(
    `UPDATE users
        SET password_hash = $3, updated_at = NOW()
      WHERE tenant_id = $1 AND lower(username) = lower($2) AND role = 'admin' AND is_active = TRUE
      RETURNING username, real_name`,
    [tid, username, hash]
  );
  if (!r.rows?.length) return { ok: false, status: 404, error: 'admin_not_found', message: '管理员账号更新失败' };
  return {
    ok: true,
    tenant_id: tid,
    username: r.rows[0].username,
    real_name: r.rows[0].real_name || '',
    temp_password: tempPassword,
  };
}
