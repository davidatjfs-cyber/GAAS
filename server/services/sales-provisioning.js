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
import { getCreditRisk } from './sales/sales-credit-risk.js';

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

async function issueTrialLicense(client, tenantId, days = 30, maxStores = null) {
  const expires = new Date(Date.now() + days * 86400000);
  await client.query(
    `INSERT INTO licenses (tenant_id, license_key, expires_at, allowed_features, status, max_stores)
     VALUES ($1, $2, $3, $4::jsonb, 'trial', $5)`,
    [tenantId, randomUUID(), expires.toISOString(), JSON.stringify(['growth', 'sales_ai', 'reports']), maxStores]
  );
  return expires;
}

/**
 * 补偿机制说明：核心事务(tenants/users/hrms_state/license)成功提交后立即把 tenant_id 和
 * provision_status='tenant_created' 落库——即使后面 startOnboarding/upsertCustomer/关联表回写
 * 任何一步失败，后台也能立刻查出"租户已经建好但销售侧关联还没完成"，而不是returned模糊500后
 * 销售不知道该不该重新点"开租户"。重试时(lead.tenant_id已存在但provision_status!=='done')
 * 直接跳过建租户/建管理员账号那段，只重跑还没完成的收尾步骤，收尾步骤本身都是幂等的
 * (upsert/COALESCE/WHERE ... IS NULL)，可以放心重跑。
 */
export async function provisionTenantFromLead(pool, leadId, {
  tenantId: requestedTenantId,
  tenantName,
  adminUsername,
  startedBy = 'sales_ai',
  trialDays = 30,
} = {}) {
  const lead = await getLead(pool, leadId);
  if (!lead) return { ok: false, error: 'lead_not_found' };
  if (lead.tenant_id && lead.provision_status === 'done') {
    return { ok: true, already: true, tenant_id: lead.tenant_id, provision_status: 'done' };
  }
  const effectiveContract = await pool.query(`SELECT 1 FROM sales_contracts WHERE lead_id=$1 AND status='effective' LIMIT 1`, [leadId]);
  if (!effectiveContract.rows?.[0]) return { ok: false, error: 'effective_contract_required' };
  const creditRisk = await getCreditRisk(pool, leadId);
  if (!creditRisk.can_provision) {
    return { ok: false, error: creditRisk.payment_type === 'cash' ? 'confirmed_payment_required' : 'credit_limit_exceeded_or_not_authorized', credit_risk: creditRisk };
  }

  let tenantId = lead.tenant_id;
  let adminUser = lead.provision_meta?.admin_username || null;
  let tempPassword = null;
  const isRetry = !!lead.tenant_id;
  const name = String(tenantName || lead.company || lead.name || lead.lead_key || '新客户').trim();

  if (!isRetry) {
    tenantId = String(requestedTenantId || '').trim();
    if (!tenantId || !/^[a-zA-Z0-9_-]{1,80}$/.test(tenantId)) tenantId = slugifyTenantId(name);
    const exists = await pool.query(`SELECT 1 FROM tenants WHERE tenant_id=$1`, [tenantId]);
    if (exists.rows?.length) tenantId = slugifyTenantId(`${name}_${lead.id}`);

    adminUser = String(adminUsername || lead.phone || `admin_${tenantId}`).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || `admin_${tenantId}`;
    tempPassword = genTempPassword();

    const client = await pool.connect();
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

    // 核心事务一旦提交，立刻落库——这一步之后即便下面全部失败，也不会有"租户已创建但
    // 数据库里查不到任何痕迹"的情况，后台巡检可以按 provision_status='tenant_created' 找出待补偿的记录。
    await pool.query(
      `UPDATE sales_leads SET tenant_id=$2, provision_status='tenant_created',
              provision_meta=$3::jsonb, updated_at=NOW() WHERE id=$1`,
      [leadId, tenantId, JSON.stringify({ admin_username: adminUser, provisioned_at: new Date().toISOString(), provisioned_by: startedBy, retry_count: 0, failed_steps: [] })]
    );
  }

  const priorMeta = isRetry ? (lead.provision_meta || {}) : { admin_username: adminUser, retry_count: 0, failed_steps: [] };
  const failedSteps = [];
  const retryCount = (priorMeta.retry_count || 0) + (isRetry ? 1 : 0);

  let onboarding = null;
  try {
    onboarding = await tenantContext.run(tenantId, () => startOnboarding(pool, { tenantId, startedBy }));
  } catch (e) {
    onboarding = { error: e?.message || String(e) };
    failedSteps.push({ step: 'startOnboarding', error: e?.message || String(e), at: new Date().toISOString() });
  }

  let growthCustomerId = priorMeta.growth_customer_id || null;
  try {
    const gc = await tenantContext.run(tenantId, () => upsertCustomer(pool, {
      phone: lead.phone || lead.extracted?.phone,
      external_userid: lead.external_userid,
      customer_meta: { source: 'sales_lead', lead_id: lead.id, lead_key: lead.lead_key, company: name },
    }, tenantId));
    growthCustomerId = gc?.id || growthCustomerId;
  } catch (e) {
    console.warn('[sales-provision] growth_customer bridge failed:', e?.message || e);
    failedSteps.push({ step: 'upsertCustomer', error: e?.message || String(e), at: new Date().toISOString() });
  }

  // 落库的 provision_meta 不含明文密码：临时密码只在首次开通的本次API响应里一次性返回给调用方
  // (前端应立即展示给销售/客户，不做二次持久化)；users表里的 password_hash 才是登录凭据来源。
  const allDone = failedSteps.length === 0;
  const provisionMeta = {
    admin_username: adminUser,
    onboarding_run_id: onboarding?.run?.id || onboarding?.id || priorMeta.onboarding_run_id || null,
    growth_customer_id: growthCustomerId,
    provisioned_at: priorMeta.provisioned_at || new Date().toISOString(),
    provisioned_by: startedBy,
    retry_count: retryCount,
    failed_steps: failedSteps,
    last_retry_at: isRetry ? new Date().toISOString() : (priorMeta.last_retry_at || null),
  };

  try {
    await pool.query(
      `UPDATE sales_leads
          SET tenant_id=$2, growth_customer_id=COALESCE($3, growth_customer_id),
              provision_status=$4, provision_meta=$5::jsonb, updated_at=NOW()
        WHERE id=$1`,
      [leadId, tenantId, growthCustomerId, allDone ? 'done' : 'partial', JSON.stringify(provisionMeta)]
    );
    await pool.query(
      `UPDATE sales_deals SET tenant_id=$2, provision_status=$3, provision_meta=$4::jsonb
        WHERE lead_id=$1 AND tenant_id IS NULL`,
      [leadId, tenantId, allDone ? 'done' : 'partial', JSON.stringify(provisionMeta)]
    );
    await pool.query(
      `UPDATE sales_trials SET tenant_id=$2, updated_at=NOW() WHERE lead_id=$1 AND tenant_id IS NULL`,
      [leadId, tenantId]
    );
  } catch (e) {
    failedSteps.push({ step: 'writeback_sales_tables', error: e?.message || String(e), at: new Date().toISOString() });
    console.error('[sales-provision] writeback failed, tenant already created:', tenantId, e?.message || e);
  }

  // 已开通的客户自动进入交付项目；这里不把“开通”伪装成“已交付”，客服/实施必须逐步推进。
  if (allDone) {
    const owners = await pool.query(
      `SELECT role, username FROM platform_admins
        WHERE status='active' AND role IN ('customer_service','implementation')
        ORDER BY role, username`
    ).catch(() => ({ rows: [] }));
    const csOwner = owners.rows.find((row) => row.role === 'customer_service')?.username || null;
    const implementationOwner = owners.rows.find((row) => row.role === 'implementation')?.username || null;
    const scopeOwner = csOwner || implementationOwner;
    if (scopeOwner) {
      await pool.query(`UPDATE sales_leads SET cs_owner_username=COALESCE(cs_owner_username,$2),updated_at=NOW() WHERE id=$1`, [leadId, scopeOwner]);
    }
    await pool.query(
      `INSERT INTO sales_delivery_projects (lead_id, tenant_id, status, cs_owner, implementation_owner, created_at, updated_at)
       VALUES ($1,$2,'pending',$3,$4,NOW(),NOW())
       ON CONFLICT (lead_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,cs_owner=COALESCE(sales_delivery_projects.cs_owner,EXCLUDED.cs_owner),implementation_owner=COALESCE(sales_delivery_projects.implementation_owner,EXCLUDED.implementation_owner),updated_at=NOW()`,
      [leadId, tenantId, csOwner, implementationOwner]
    ).catch((e) => console.warn('[sales-provision] delivery project creation failed:', e?.message || e));
  }

  await addEvent(pool, leadId, {
    event_type: allDone ? 'TENANT_PROVISIONED' : 'TENANT_PROVISIONED_PARTIAL',
    summary: allDone ? `已开通租户 ${tenantId}` : `租户 ${tenantId} 已创建，${failedSteps.length}个收尾步骤待重试`,
    priority: allDone ? 'high' : 'high',
    recommended_action: allDone ? 'onboarding' : 'retry_provisioning',
    payload: { tenant_id: tenantId, admin_username: adminUser, failed_steps: failedSteps, retry_count: retryCount },
  }).catch(() => null);

  return {
    ok: true,
    tenant_id: tenantId,
    tenant_name: name,
    admin_username: adminUser,
    temp_password: tempPassword, // 只有首次开通(非重试)才非空
    onboarding,
    growth_customer_id: growthCustomerId,
    provision_meta: provisionMeta,
    needs_retry: !allDone,
    failed_steps: failedSteps,
  };
}

/** 每张订单独立开通一个租户；同一品牌多门店不会复用客户主档的 tenant_id。 */
export async function provisionTenantFromOrder(pool, orderId, { startedBy = 'finance' } = {}) {
  const q = await pool.query(`SELECT o.*,l.company,l.name,l.phone,l.external_userid,p.payment_type,p.status AS pool_status
    FROM sales_orders o JOIN sales_leads l ON l.id=o.lead_id JOIN sales_credit_pools p ON p.id=o.credit_pool_id WHERE o.id=$1`, [orderId]);
  const order = q.rows?.[0];
  if (!order) return { ok: false, error: 'order_not_found' };
  if (order.provision_status === 'done') return { ok: true, already: true, tenant_id: order.tenant_id };
  if (!['paid','credit_approved','provisioning'].includes(order.status) || order.pool_status !== 'active') return { ok: false, error: 'order_not_eligible' };
  const existing = await pool.query(`SELECT tenant_id FROM sales_orders WHERE lead_id=$1 AND status='provisioned' AND tenant_id IS NOT NULL ORDER BY id ASC LIMIT 1`, [order.lead_id]);
  const existingTenantId = existing.rows?.[0]?.tenant_id || null;
  if (existingTenantId) {
    if (order.order_type === 'renewal') {
      const renewed = await pool.query(`UPDATE tenant_store_licenses SET expires_at=GREATEST(expires_at,NOW()) + ($3::text || ' days')::interval,updated_at=NOW() WHERE id=(SELECT id FROM tenant_store_licenses WHERE tenant_id=$1 AND store_name=$2 AND status='active' ORDER BY expires_at DESC LIMIT 1) RETURNING *`, [existingTenantId, order.store_name, Number(order.license_days) || 365]);
      if (!renewed.rows?.[0]) return { ok:false, error:'store_license_not_found', message:'续约订单必须对应已开通门店的许可证' };
      await pool.query(`UPDATE sales_orders SET tenant_id=$2,provision_status='done',status='provisioned',provision_meta=$3::jsonb,updated_at=NOW() WHERE id=$1`, [order.id, existingTenantId, JSON.stringify({ action:'renewal', renewed_by:startedBy, renewed_at:new Date().toISOString() })]);
      return { ok:true, tenant_id:existingTenantId, reused:true, action:'renewal' };
    }
    const storeQty = Math.max(1, Number(order.store_quantity) || 1);
    const stateRow = await pool.query(`SELECT data FROM hrms_state WHERE key=$1`, [existingTenantId]);
    const state = stateRow.rows?.[0]?.data || {};
    const stores = Array.isArray(state.stores) ? state.stores.slice() : [];
    const current = stores.length;
    await pool.query(`UPDATE licenses SET max_stores=COALESCE(max_stores,$2)+$3 WHERE id=(SELECT id FROM licenses WHERE tenant_id=$1 AND status IN ('active','trial') ORDER BY expires_at DESC LIMIT 1)`, [existingTenantId,current,storeQty]);
    const brandName = String(order.brand_name || '').trim(); const brandId = String(order.brand_key || brandName || 'default').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'_');
    const storeId=`store_${Date.now()}`;
    stores.push({ id:storeId, name:order.store_name, address:order.store_address || '', managerName:order.contact_name || '', phone:order.contact_phone || '', brand:brandName, brandName, brandId, restaurantType:order.restaurant_type || '', area_sqm:order.area_sqm || null, status:'active', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    const brands = Array.isArray(state.brands) ? state.brands.slice() : [];
    if (brandName && !brands.some((b) => String(b.id || '').toLowerCase() === brandId)) brands.push({ id:brandId,name:brandName,config:{ sopKeypoints:[],performanceWeights:{} } });
    await pool.query(`UPDATE hrms_state SET data=$2::jsonb,updated_at=NOW() WHERE key=$1`, [existingTenantId, JSON.stringify({ ...state, stores, brands })]);
    await pool.query(`INSERT INTO tenant_store_licenses (tenant_id,order_id,store_id,store_name,expires_at) VALUES ($1,$2,$3,$4,NOW() + ($5::text || ' days')::interval)`, [existingTenantId,order.id,storeId,order.store_name,Number(order.license_days)||365]);
    await pool.query(`UPDATE sales_orders SET tenant_id=$2,provision_status='done',status='provisioned',provision_meta=$3::jsonb,updated_at=NOW() WHERE id=$1`, [order.id,existingTenantId,JSON.stringify({ action:'add_store', store_quantity:storeQty, added_by:startedBy, added_at:new Date().toISOString() })]);
    await pool.query(`INSERT INTO sales_order_delivery_projects (order_id,tenant_id,status) VALUES ($1,$2,'pending')`, [order.id,existingTenantId]);
    return { ok:true, tenant_id:existingTenantId, reused:true, action:'add_store', added_stores:storeQty };
  }
  const tenantName = String(order.store_name || order.company || order.name).trim();
  const tenantId = slugifyTenantId(`${tenantName}_${order.id}`);
  const adminUsername = String(order.contact_phone || order.phone || `admin_${tenantId}`).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40) || `admin_${tenantId}`;
  const tempPassword = genTempPassword();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO tenants (tenant_id,name,mode,status) VALUES ($1,$2,'managed','provisioning')`, [tenantId, tenantName]);
    await client.query(`INSERT INTO users (id,username,password_hash,real_name,role,is_active,tenant_id) VALUES (gen_random_uuid(),$1,$2,$3,'admin',TRUE,$4)`, [adminUsername, await bcrypt.hash(tempPassword, 10), tenantName, tenantId]);
    await client.query(`INSERT INTO hrms_state (key,data,updated_at) VALUES ($1,$2::jsonb,NOW()) ON CONFLICT (key) DO NOTHING`, [tenantId, JSON.stringify(createEmptyTenantState({ tenantId, tenantName, adminUsername, adminName: tenantName }))]);
    await savePlatformProfile(client, tenantId, tenantName);
    await issueTrialLicense(client, tenantId, 30, Math.max(1, Number(order.store_quantity) || 1));
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); return { ok: false, error: 'provision_failed', message: e?.message }; } finally { client.release(); }
  await pool.query(`UPDATE sales_orders SET tenant_id=$2,provision_status='done',provision_meta=$3::jsonb,status='provisioned',updated_at=NOW() WHERE id=$1`, [order.id, tenantId, JSON.stringify({ admin_username: adminUsername, provisioned_by: startedBy, provisioned_at: new Date().toISOString() })]);
  const firstStoreId = `store_${Date.now()}`;
  const firstState = await pool.query(`SELECT data FROM hrms_state WHERE key=$1`, [tenantId]);
  const firstData = firstState.rows?.[0]?.data || {};
  const firstBrandName = String(order.brand_name || '').trim(); const firstBrandId = String(order.brand_key || firstBrandName || 'default').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'_');
  const firstStores = Array.isArray(firstData.stores) ? firstData.stores.slice() : [];
  firstStores.push({ id:firstStoreId,name:order.store_name,address:order.store_address || '',managerName:order.contact_name || '',phone:order.contact_phone || '',brand:firstBrandName,brandName:firstBrandName,brandId:firstBrandId,status:'active',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString() });
  const firstBrands=Array.isArray(firstData.brands)?firstData.brands.slice():[]; if(firstBrandName&&!firstBrands.some((b)=>String(b.id||'')===firstBrandId)) firstBrands.push({id:firstBrandId,name:firstBrandName,config:{sopKeypoints:[],performanceWeights:{}}});
  await pool.query(`UPDATE hrms_state SET data=$2::jsonb,updated_at=NOW() WHERE key=$1`,[tenantId,JSON.stringify({...firstData,stores:firstStores,brands:firstBrands})]);
  await pool.query(`INSERT INTO tenant_store_licenses (tenant_id,order_id,store_id,store_name,expires_at) VALUES ($1,$2,$3,$4,NOW() + ($5::text || ' days')::interval)`,[tenantId,order.id,firstStoreId,order.store_name,Number(order.license_days)||365]);
  const owners = await pool.query(`SELECT role,username FROM platform_admins WHERE status='active' AND role IN ('customer_service','implementation') ORDER BY role,username`).catch(() => ({ rows: [] }));
  const cs = owners.rows.find((x) => x.role === 'customer_service')?.username || null;
  const impl = owners.rows.find((x) => x.role === 'implementation')?.username || null;
  await pool.query(`INSERT INTO sales_order_delivery_projects (order_id,tenant_id,status,cs_owner,implementation_owner) VALUES ($1,$2,'pending',$3,$4)`, [order.id, tenantId, cs, impl]);
  await addEvent(pool, order.lead_id, { event_type: 'ORDER_PROVISIONED', summary: `订单 ${order.order_no} 已开通租户 ${tenantId}`, priority: 'high', recommended_action: 'onboarding', payload: { order_id: order.id, tenant_id: tenantId } }).catch(() => null);
  return { ok: true, tenant_id: tenantId, admin_username: adminUsername, temp_password: tempPassword };
}

/** 最终交付时生成一次性凭据；明文只返回本次调用，不写入销售表或日志。 */
export async function rotateTenantAdminCredentials(pool, leadId) {
  const lead = await getLead(pool, leadId);
  if (!lead?.tenant_id || lead.provision_status !== 'done') return { ok: false, error: 'tenant_not_ready' };
  const username = lead.provision_meta?.admin_username;
  if (!username) return { ok: false, error: 'admin_username_missing' };
  const password = genTempPassword();
  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    `UPDATE users SET password_hash=$3 WHERE tenant_id=$1 AND username=$2 AND role='admin' RETURNING username,real_name`,
    [lead.tenant_id, username, hash]
  );
  if (!r.rows?.[0]) return { ok: false, error: 'tenant_admin_not_found' };
  return { ok: true, tenant_id: lead.tenant_id, username, temp_password: password };
}

/** 后台巡检用：找出"租户已创建但销售侧收尾未完成"的记录，供人工或定时任务重试 */
export async function listPendingProvisioningCompensations(pool, { limit = 50 } = {}) {
  const r = await pool.query(
    `SELECT id, lead_key, company, tenant_id, provision_status, provision_meta, updated_at
       FROM sales_leads
      WHERE provision_status IN ('tenant_created', 'partial')
      ORDER BY updated_at ASC
      LIMIT $1`,
    [limit]
  );
  return r.rows || [];
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
