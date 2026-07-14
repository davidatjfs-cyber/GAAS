/**
 * 成交后自动开通租户 + onboarding + growth_customers 桥接
 */
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'crypto';
import { tenantContext } from '../utils/database.js';
import { createEmptyTenantState } from '../tenant-login.js';
import { startOnboarding } from './tenant-onboarding-service.js';
import { upsertCustomer } from '../growth-api.js';
import { getLead, addEvent } from './sales/sales-store.js';

const DEFAULT_PROFILE = {
  system_name: 'GAAS 增长平台',
  page_title: '平台控制台',
  brand_color: '#0d7a5f',
  tagline: '',
  feature_switches: {},
  billing: {},
  alerts: { notify_days_before_expiry: 7 },
  template_switches: {},
};

function slugifyTenantId(input = '') {
  const base = String(input || 'client')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const ascii = base.replace(/[^\x00-\x7f]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const prefix = ascii && ascii.length >= 3 ? ascii : 'brand';
  const suffix = randomBytes(3).toString('hex');
  return `${prefix}_${suffix}`.slice(0, 80);
}

function genTempPassword() {
  return `Gaas${randomBytes(4).toString('hex')}!`;
}

async function savePlatformProfile(client, tenantId, name) {
  const profile = {
    ...DEFAULT_PROFILE,
    system_name: name,
    page_title: `${name} 平台控制台`,
    notes: `销售成交自动开通 ${new Date().toISOString()}`,
  };
  await client.query(
    `INSERT INTO tenant_config (tenant_key, config_key, config_value)
     VALUES ($1, 'platform_profile', $2::jsonb)
     ON CONFLICT (tenant_key, config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
    [tenantId, JSON.stringify(profile)]
  );
}

async function issueTrialLicense(client, tenantId, days = 30) {
  const expires = new Date(Date.now() + days * 86400000);
  await client.query(
    `INSERT INTO licenses (tenant_id, license_key, expires_at, allowed_features, status)
     VALUES ($1, $2, $3, $4::jsonb, 'trial')`,
    [tenantId, randomUUID(), expires.toISOString(), JSON.stringify(['growth', 'sales_ai', 'reports'])]
  );
  return expires;
}

export async function provisionTenantFromLead(pool, leadId, {
  tenantId: requestedTenantId,
  tenantName,
  adminUsername,
  startedBy = 'sales_ai',
  trialDays = 30,
} = {}) {
  const lead = await getLead(pool, leadId);
  if (!lead) return { ok: false, error: 'lead_not_found' };
  if (lead.tenant_id) {
    return { ok: true, already: true, tenant_id: lead.tenant_id, provision_status: lead.provision_status || 'done' };
  }

  const name = String(tenantName || lead.company || lead.name || lead.lead_key || '新客户').trim();
  let tenantId = String(requestedTenantId || '').trim();
  if (!tenantId || !/^[a-zA-Z0-9_-]{1,80}$/.test(tenantId)) tenantId = slugifyTenantId(name);

  const exists = await pool.query(`SELECT 1 FROM tenants WHERE tenant_id=$1`, [tenantId]);
  if (exists.rows?.length) tenantId = slugifyTenantId(`${name}_${lead.id}`);

  const adminUser = String(adminUsername || lead.phone || `admin_${tenantId}`).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || `admin_${tenantId}`;
  const tempPassword = genTempPassword();

  const client = await pool.connect();
  let onboarding = null;
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tenants (tenant_id, name, mode, status) VALUES ($1, $2, 'managed', 'provisioning')`,
      [tenantId, name]
    );
    const hash = await bcrypt.hash(tempPassword, 10);
    await client.query(
      `INSERT INTO users (id, username, password_hash, real_name, role, is_active, tenant_id)
       VALUES (gen_random_uuid(), $1, $2, $3, 'admin', TRUE, $4)`,
      [adminUser, hash, name, tenantId]
    );
    await client.query(
      `INSERT INTO hrms_state (key, data, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO NOTHING`,
      [tenantId, JSON.stringify(createEmptyTenantState({ tenantId, tenantName: name, adminUsername: adminUser, adminName: name }))]
    );
    await savePlatformProfile(client, tenantId, name);
    await issueTrialLicense(client, tenantId, trialDays);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return { ok: false, error: 'provision_failed', message: e?.message || String(e) };
  } finally {
    client.release();
  }

  try {
    onboarding = await tenantContext.run(tenantId, () => startOnboarding(pool, { tenantId, startedBy }));
  } catch (e) {
    onboarding = { error: e?.message || String(e) };
  }

  let growthCustomerId = null;
  try {
    const gc = await tenantContext.run(tenantId, () => upsertCustomer(pool, {
      phone: lead.phone || lead.extracted?.phone,
      external_userid: lead.external_userid,
      customer_meta: { source: 'sales_lead', lead_id: lead.id, lead_key: lead.lead_key, company: name },
    }, tenantId));
    growthCustomerId = gc?.id || null;
  } catch (e) {
    console.warn('[sales-provision] growth_customer bridge failed:', e?.message || e);
  }

  // 落库的 provision_meta 不含明文密码：临时密码只在本次API响应里一次性返回给调用方
  // (前端应立即展示给销售/客户，不做二次持久化)；users表里的 password_hash 才是登录凭据来源。
  const provisionMeta = {
    admin_username: adminUser,
    onboarding_run_id: onboarding?.run?.id || onboarding?.id || null,
    growth_customer_id: growthCustomerId,
    provisioned_at: new Date().toISOString(),
    provisioned_by: startedBy,
  };

  await pool.query(
    `UPDATE sales_leads
        SET tenant_id=$2, growth_customer_id=COALESCE($3, growth_customer_id),
            provision_status='done', provision_meta=$4::jsonb, updated_at=NOW()
      WHERE id=$1`,
    [leadId, tenantId, growthCustomerId, JSON.stringify(provisionMeta)]
  );
  await pool.query(
    `UPDATE sales_deals SET tenant_id=$2, provision_status='done', provision_meta=$3::jsonb, updated_at=NOW()
      WHERE lead_id=$1 AND tenant_id IS NULL`,
    [leadId, tenantId, JSON.stringify(provisionMeta)]
  );
  await pool.query(
    `UPDATE sales_trials SET tenant_id=$2, updated_at=NOW() WHERE lead_id=$1 AND tenant_id IS NULL`,
    [leadId, tenantId]
  );

  await addEvent(pool, leadId, {
    event_type: 'TENANT_PROVISIONED',
    summary: `已开通租户 ${tenantId}`,
    priority: 'high',
    recommended_action: 'onboarding',
    payload: { tenant_id: tenantId, admin_username: adminUser, onboarding_run_id: provisionMeta.onboarding_run_id },
  });

  return {
    ok: true,
    tenant_id: tenantId,
    tenant_name: name,
    admin_username: adminUser,
    temp_password: tempPassword,
    onboarding,
    growth_customer_id: growthCustomerId,
    provision_meta: provisionMeta,
  };
}

export async function completeDealWithProvisioning(pool, dealParams, { provision = true, startedBy } = {}) {
  const { createDeal } = await import('./sales/sales-store.js');
  const deal = await createDeal(pool, dealParams);
  let provisionResult = null;
  if (provision) {
    provisionResult = await provisionTenantFromLead(pool, dealParams.leadId, { startedBy });
  }
  return { deal, provision: provisionResult };
}
