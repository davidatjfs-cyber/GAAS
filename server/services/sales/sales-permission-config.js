/**
 * 销售CRM"分模块/分权限"可配置设置：数据可见范围(own=只看自己/all=全量)和CRM导航模块可见性
 * 按角色可在后台调整，不用改代码发版。sales-permissions.js 的记录级判断和 platform-admin.html
 * 的CRM导航都读这里的配置；缓存60秒，避免每次权限判断都查库。
 */
const CACHE_TTL_MS = 60_000;
let _cache = null;
let _cacheAt = 0;

// CRM导航的6个模块，对应 platform-admin.html #salesCrmNav 的 data-scroll-target。
export const SALES_MODULES = [
  { key: 'crmOverviewSection', label: 'CRM总览' },
  { key: 'crmCustomersSection', label: '客户管理' },
  { key: 'crmTodaySection', label: '今日跟进' },
  { key: 'crmFinanceSection', label: '合同回款' },
  { key: 'crmContentSection', label: '内容培育' },
  { key: 'crmPerformanceSection', label: '区域业绩' },
];
const ALL_MODULE_KEYS = SALES_MODULES.map((m) => m.key);

// 可在设置页里调整的角色；super_admin不在列表里——它永远全量可见，不接受被配置成受限。
export const SALES_CONFIGURABLE_ROLES = [
  { role: 'sales_manager', label: '销售经理' },
  { role: 'general_manager', label: '总经理' },
  { role: 'sales', label: '销售' },
  { role: 'customer_service', label: '客服' },
  { role: 'implementation', label: '实施' },
  { role: 'finance', label: '财务' },
  { role: 'auditor', label: '审计' },
];

// 与改造前的硬编码行为(sales-permissions.js 里原来的 MANAGER_ROLES/FULL_VIEW_ROLES)完全一致，
// 保证没人配置过的情况下线上行为不变。
export const DEFAULT_SALES_PERMISSION_CONFIG = {
  super_admin: { data_scope: 'all', modules: ALL_MODULE_KEYS },
  general_manager: { data_scope: 'all', modules: ALL_MODULE_KEYS },
  sales_manager: { data_scope: 'all', modules: ALL_MODULE_KEYS },
  auditor: { data_scope: 'all', modules: ALL_MODULE_KEYS },
  sales: { data_scope: 'own', modules: ['crmOverviewSection', 'crmCustomersSection', 'crmTodaySection', 'crmFinanceSection', 'crmContentSection'] },
  customer_service: { data_scope: 'own', modules: ['crmOverviewSection', 'crmCustomersSection'] },
  implementation: { data_scope: 'own', modules: ['crmOverviewSection', 'crmCustomersSection'] },
  finance: { data_scope: 'all', modules: ['crmFinanceSection'] },
};

export async function ensureSalesPermissionConfigTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_permission_config (
      role TEXT PRIMARY KEY,
      data_scope TEXT NOT NULL DEFAULT 'own' CHECK (data_scope IN ('own','all')),
      modules JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

/** 合并数据库覆盖值和默认值，缺的角色/字段回退默认，避免半配置导致某个角色权限判断出现 undefined。 */
function mergeWithDefaults(dbRows) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_SALES_PERMISSION_CONFIG));
  for (const row of dbRows || []) {
    if (!merged[row.role]) continue; // 不认识的角色名不接受(比如手滑存进去一个错别字角色)
    merged[row.role] = {
      data_scope: ['own', 'all'].includes(row.data_scope) ? row.data_scope : merged[row.role].data_scope,
      modules: Array.isArray(row.modules) ? row.modules.filter((m) => ALL_MODULE_KEYS.includes(m)) : merged[row.role].modules,
    };
  }
  return merged;
}

export async function refreshSalesPermissionConfigCache(pool) {
  await ensureSalesPermissionConfigTable(pool);
  const r = await pool.query(`SELECT role, data_scope, modules FROM sales_permission_config`);
  _cache = mergeWithDefaults(r.rows);
  _cacheAt = Date.now();
  return _cache;
}

/** 同步读取：给 sales-permissions.js 这类不方便到处传pool/await的调用点用，缓存过期前直接返回。 */
export function getSalesPermissionConfigSync() {
  return _cache || DEFAULT_SALES_PERMISSION_CONFIG;
}

export async function getSalesPermissionConfig(pool) {
  if (!_cache || Date.now() - _cacheAt > CACHE_TTL_MS) {
    return refreshSalesPermissionConfigCache(pool);
  }
  return _cache;
}

export async function saveSalesPermissionConfig(pool, config, updatedBy) {
  await ensureSalesPermissionConfigTable(pool);
  const allowedRoles = new Set(SALES_CONFIGURABLE_ROLES.map((r) => r.role));
  for (const [role, value] of Object.entries(config || {})) {
    if (!allowedRoles.has(role)) continue; // super_admin等不允许被配置
    const dataScope = value?.data_scope === 'all' ? 'all' : 'own';
    const modules = Array.isArray(value?.modules) ? value.modules.filter((m) => ALL_MODULE_KEYS.includes(m)) : [];
    await pool.query(
      `INSERT INTO sales_permission_config (role, data_scope, modules, updated_by, updated_at)
       VALUES ($1,$2,$3::jsonb,$4,NOW())
       ON CONFLICT (role) DO UPDATE SET data_scope=EXCLUDED.data_scope, modules=EXCLUDED.modules, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
      [role, dataScope, JSON.stringify(modules), updatedBy || null]
    );
  }
  return refreshSalesPermissionConfigCache(pool);
}
