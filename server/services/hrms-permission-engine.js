/**
 * HRMS 统一权限引擎
 *
 * - legacy（默认）：与洪潮/马己仙现有硬编码角色行为完全一致
 * - hybrid：legacy 角色权限 ∪ 显式授权（适合渐进迁移）
 * - strict：仅显式授权，未授权即拒绝（适合多租户托管）
 */
import { pool as getPool } from '../utils/database.js';

export const ENFORCEMENT_MODES = ['legacy', 'hybrid', 'strict'];

/** 权限目录（全局定义，按租户种子） */
export const PERMISSION_CATALOG = [
  { id: 'module.reports', category: 'module', label: '分析报表入口', sensitive: false },
  { id: 'reports.business.view', category: 'reports', label: '业务报表', sensitive: false },
  { id: 'reports.attendance.view', category: 'reports', label: '考勤报表', sensitive: false },
  { id: 'reports.daily_register.view', category: 'reports', label: '出勤表台账', sensitive: false },
  { id: 'reports.payroll.view', category: 'payroll', label: '查看薪资报表', sensitive: true },
  { id: 'reports.payroll.export', category: 'payroll', label: '导出薪资报表', sensitive: true },
  { id: 'reports.payroll.adjust', category: 'payroll', label: '调整补贴/底薪', sensitive: true },
  { id: 'reports.payroll.audit', category: 'payroll', label: '薪资审核切换', sensitive: true },
  { id: 'reports.payroll.month_run', category: 'payroll', label: '月结锁定/发放', sensitive: true },
  { id: 'reports.payroll.rules', category: 'payroll', label: '考勤薪资规则管理', sensitive: true },
  { id: 'reports.payroll.ledger', category: 'payroll', label: '查看薪资账本', sensitive: true },
  { id: 'reports.payroll.abnormal_confirm', category: 'payroll', label: '确认考勤异常', sensitive: true },
  { id: 'reports.payroll.reconcile', category: 'payroll', label: '重算考勤日结果', sensitive: true },
  { id: 'reports.leave_owed.view', category: 'payroll', label: '查看欠休报表', sensitive: true },
  { id: 'reports.leave_owed.adjust', category: 'payroll', label: '调整累计假期', sensitive: true },
  { id: 'employee.salary.view', category: 'payroll', label: '查看员工薪资字段', sensitive: true },
  { id: 'employee.salary.edit', category: 'payroll', label: '编辑员工薪资', sensitive: true },
  { id: 'admin.permission_manage', category: 'admin', label: '管理权限配置', sensitive: true },
];

/** 与现有 canAccess* 函数对齐的 legacy 角色权限表 */
export const LEGACY_ROLE_PERMISSIONS = {
  admin: ['*'],
  hr_manager: [
    'module.reports',
    'reports.business.view',
    'reports.attendance.view',
    'reports.daily_register.view',
    'reports.payroll.view',
    'reports.payroll.export',
    'reports.payroll.adjust',
    'reports.payroll.audit',
    'reports.payroll.month_run',
    'reports.payroll.rules',
    'reports.payroll.ledger',
    'reports.payroll.abnormal_confirm',
    'reports.payroll.reconcile',
    'reports.leave_owed.view',
    'reports.leave_owed.adjust',
    'employee.salary.view',
    'employee.salary.edit',
    'admin.permission_manage',
  ],
  hq_manager: [
    'module.reports',
    'reports.business.view',
    'reports.attendance.view',
    'reports.daily_register.view',
    'reports.payroll.view',
    'reports.payroll.audit',
    'reports.payroll.month_run',
    'reports.payroll.ledger',
    'reports.payroll.abnormal_confirm',
    'reports.payroll.reconcile',
    'reports.leave_owed.view',
    'employee.salary.view',
  ],
  store_manager: [
    'module.reports',
    'reports.business.view',
    'reports.attendance.view',
    'reports.payroll.view',
    'reports.payroll.abnormal_confirm',
    'reports.leave_owed.view',
    'employee.salary.view',
  ],
  store_production_manager: [
    'module.reports',
    'reports.attendance.view',
    'reports.payroll.view',
    'reports.leave_owed.view',
  ],
};

const policyCache = new Map();
const POLICY_TTL_MS = 30_000;

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function tenantKey(tenantId) {
  return String(tenantId || 'default').trim() || 'default';
}

export async function ensurePermissionTables(db = getPool()) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_permission_policies (
      tenant_id VARCHAR(64) PRIMARY KEY,
      enforcement_mode VARCHAR(16) NOT NULL DEFAULT 'legacy',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by VARCHAR(100)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_permission_definitions (
      tenant_id VARCHAR(64) NOT NULL,
      permission_id VARCHAR(80) NOT NULL,
      category VARCHAR(32) NOT NULL DEFAULT 'general',
      label_zh VARCHAR(128) NOT NULL DEFAULT '',
      description_zh TEXT,
      sensitive BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (tenant_id, permission_id)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_permission_grants (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      grantee_type VARCHAR(24) NOT NULL,
      grantee_key VARCHAR(128) NOT NULL,
      permission_id VARCHAR(80) NOT NULL,
      store_scope VARCHAR(24) NOT NULL DEFAULT 'inherit',
      granted_by VARCHAR(100),
      granted_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (tenant_id, grantee_type, grantee_key, permission_id)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_permission_audit_log (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      actor_username VARCHAR(100),
      action VARCHAR(48) NOT NULL,
      detail JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
}

export async function seedPermissionCatalog(tenantId, db = getPool()) {
  const tid = tenantKey(tenantId);
  for (const def of PERMISSION_CATALOG) {
    await db.query(
      `INSERT INTO hrms_permission_definitions (tenant_id, permission_id, category, label_zh, description_zh, sensitive)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, permission_id) DO NOTHING`,
      [tid, def.id, def.category, def.label, def.description || null, !!def.sensitive]
    );
  }
}

export async function getTenantEnforcementMode(tenantId, db = getPool()) {
  const tid = tenantKey(tenantId);
  const cached = policyCache.get(tid);
  if (cached && Date.now() - cached.at < POLICY_TTL_MS) return cached.mode;
  try {
    const r = await db.query(
      `SELECT enforcement_mode FROM hrms_permission_policies WHERE tenant_id = $1 LIMIT 1`,
      [tid]
    );
    const mode = String(r.rows?.[0]?.enforcement_mode || 'legacy').trim() || 'legacy';
    const safe = ENFORCEMENT_MODES.includes(mode) ? mode : 'legacy';
    policyCache.set(tid, { mode: safe, at: Date.now() });
    return safe;
  } catch (_) {
    return 'legacy';
  }
}

export function invalidatePermissionPolicyCache(tenantId) {
  policyCache.delete(tenantKey(tenantId));
}

export async function setTenantEnforcementMode({ tenantId, mode, updatedBy, db = getPool() }) {
  const tid = tenantKey(tenantId);
  const m = String(mode || '').trim();
  if (!ENFORCEMENT_MODES.includes(m)) return { ok: false, error: 'invalid_mode' };
  await ensurePermissionTables(db);
  await seedPermissionCatalog(tid, db);
  await db.query(
    `INSERT INTO hrms_permission_policies (tenant_id, enforcement_mode, updated_at, updated_by)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (tenant_id) DO UPDATE SET enforcement_mode = EXCLUDED.enforcement_mode, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [tid, m, updatedBy || null]
  );
  invalidatePermissionPolicyCache(tid);
  if (m === 'hybrid' || m === 'strict') {
    await seedLegacyRoleGrants(tid, updatedBy, db);
  }
  return { ok: true, enforcement_mode: m };
}

export async function seedLegacyRoleGrants(tenantId, grantedBy, db = getPool()) {
  const tid = tenantKey(tenantId);
  for (const [role, perms] of Object.entries(LEGACY_ROLE_PERMISSIONS)) {
    const list = Array.isArray(perms) ? perms : [];
    for (const perm of list) {
      if (perm === '*') continue;
      await db.query(
        `INSERT INTO hrms_permission_grants (tenant_id, grantee_type, grantee_key, permission_id, store_scope, granted_by)
         VALUES ($1, 'role', $2, $3, 'inherit', $4)
         ON CONFLICT (tenant_id, grantee_type, grantee_key, permission_id) DO NOTHING`,
        [tid, role, perm, grantedBy || 'system_seed']
      );
    }
    if (list.includes('*')) {
      for (const def of PERMISSION_CATALOG) {
        await db.query(
          `INSERT INTO hrms_permission_grants (tenant_id, grantee_type, grantee_key, permission_id, store_scope, granted_by)
           VALUES ($1, 'role', $2, $3, 'all', $4)
           ON CONFLICT (tenant_id, grantee_type, grantee_key, permission_id) DO NOTHING`,
          [tid, role, def.id, grantedBy || 'system_seed']
        );
      }
    }
  }
}

export function legacyRoleHasPermission(role, permission) {
  const r = normalizeRole(role);
  const perms = LEGACY_ROLE_PERMISSIONS[r];
  if (!perms) return false;
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

/** 与 index.js canAccessAnalyticsReports 对齐（legacy 网关） */
export function legacyCanAccessAnalyticsReports(role) {
  const r = String(role || '').trim();
  return r === 'admin' || r === 'hq_manager' || r === 'store_manager' || r === 'hr_manager' || r === 'store_production_manager';
}

export function legacyCanManagePayrollRules(role) {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'hr_manager' || r === 'hq_manager';
}

function storeAllowedForUser(req, store) {
  const target = String(store || '').trim();
  if (!target) return true;
  const allowed = Array.isArray(req?.user?.allowed_stores) ? req.user.allowed_stores : [];
  if (!allowed.length) {
    const mine = String(req?.user?.store || req?.user?.current_store || '').trim();
    return !mine || mine === target;
  }
  return allowed.includes(target);
}

async function loadExplicitGrants(tenantId, granteeSpecs, db) {
  if (!granteeSpecs.length) return [];
  const tid = tenantKey(tenantId);
  const clauses = [];
  const params = [tid];
  let idx = 2;
  for (const spec of granteeSpecs) {
    clauses.push(`(grantee_type = $${idx} AND grantee_key = $${idx + 1})`);
    params.push(spec.type, spec.key);
    idx += 2;
  }
  const sql = `SELECT permission_id, store_scope, grantee_type, grantee_key
                 FROM hrms_permission_grants
                WHERE tenant_id = $1 AND (${clauses.join(' OR ')})`;
  const r = await db.query(sql, params);
  return r.rows || [];
}

function grantsToPermissionSet(rows) {
  const set = new Set();
  for (const row of rows || []) {
    const pid = String(row.permission_id || '').trim();
    if (pid) set.add(pid);
  }
  return set;
}

export async function resolveUserPermissionContext(req, opts = {}) {
  const db = opts.db || getPool();
  const tenantId = tenantKey(req?.tenantId || req?.user?.tenant_id || 'default');
  const username = String(req?.user?.username || '').trim();
  const role = normalizeRole(req?.user?.role);
  const mode = await getTenantEnforcementMode(tenantId, db);

  let permissionGroupId = opts.permissionGroupId ?? null;
  let groupPermissions = [];
  if (!permissionGroupId && typeof opts.getSharedState === 'function' && username) {
    try {
      const state = (await opts.getSharedState(tenantId)) || {};
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const emp = employees.find((e) => String(e?.username || '').trim().toLowerCase() === username.toLowerCase());
      permissionGroupId = String(emp?.permissionGroupId || '').trim() || null;
      if (permissionGroupId) {
        const groups = Array.isArray(state.permissionGroups) ? state.permissionGroups : [];
        const grp = groups.find((g) => String(g?.id || '') === permissionGroupId);
        if (grp && Array.isArray(grp.permissions)) groupPermissions = grp.permissions.map((p) => String(p).trim()).filter(Boolean);
      }
    } catch (_) {}
  }

  const explicitSpecs = [{ type: 'role', key: role }];
  if (permissionGroupId) explicitSpecs.push({ type: 'permission_group', key: permissionGroupId });
  if (username) explicitSpecs.push({ type: 'user', key: username.toLowerCase() });

  let explicitSet = new Set();
  if (mode !== 'legacy') {
    try {
      const rows = await loadExplicitGrants(tenantId, explicitSpecs, db);
      explicitSet = grantsToPermissionSet(rows);
      for (const p of groupPermissions) explicitSet.add(p);
    } catch (_) {}
  }

  const effective = new Set();
  if (mode === 'legacy' || mode === 'hybrid') {
    if (legacyRoleHasPermission(role, '*')) {
      for (const def of PERMISSION_CATALOG) effective.add(def.id);
    } else {
      const legacyList = LEGACY_ROLE_PERMISSIONS[role] || [];
      for (const p of legacyList) {
        if (p !== '*') effective.add(p);
      }
    }
  }
  if (mode === 'hybrid' || mode === 'strict') {
    for (const p of explicitSet) effective.add(p);
  }

  return {
    tenantId,
    username,
    role,
    enforcement_mode: mode,
    permissions: Array.from(effective).sort(),
    permission_group_id: permissionGroupId,
  };
}

export async function checkHrmsPermission(req, permission, opts = {}) {
  const perm = String(permission || '').trim();
  if (!perm) return { ok: false, reason: 'missing_permission' };
  const ctx = await resolveUserPermissionContext(req, opts);
  const allowed = ctx.permissions.includes(perm) || ctx.permissions.includes('*');
  if (!allowed) {
    return { ok: false, reason: 'permission_denied', enforcement_mode: ctx.enforcement_mode, permission: perm };
  }
  const store = String(opts.store || '').trim();
  if (store && !storeAllowedForUser(req, store)) {
    return { ok: false, reason: 'store_scope_denied', store };
  }
  return { ok: true, ctx };
}

export async function requireHrmsPermission(req, res, permission, opts = {}) {
  const result = await checkHrmsPermission(req, permission, opts);
  if (!result.ok) {
    res.status(403).json({
      error: 'forbidden',
      permission: String(permission || ''),
      reason: result.reason || 'permission_denied',
      enforcement_mode: result.enforcement_mode || undefined,
    });
    return false;
  }
  return true;
}

/** legacy 兼容包装：分析报表网关 */
export async function canAccessAnalyticsReportsForReq(req, opts = {}) {
  const mode = await getTenantEnforcementMode(req?.tenantId || req?.user?.tenant_id, opts.db);
  if (mode === 'legacy') return legacyCanAccessAnalyticsReports(req?.user?.role);
  const r = await checkHrmsPermission(req, 'module.reports', opts);
  return r.ok;
}

export async function canManagePayrollRulesForReq(req, opts = {}) {
  const mode = await getTenantEnforcementMode(req?.tenantId || req?.user?.tenant_id, opts.db);
  if (mode === 'legacy') return legacyCanManagePayrollRules(req?.user?.role);
  const r = await checkHrmsPermission(req, 'reports.payroll.rules', opts);
  return r.ok;
}

export async function listPermissionGrants(tenantId, db = getPool()) {
  const tid = tenantKey(tenantId);
  const r = await db.query(
    `SELECT grantee_type, grantee_key, permission_id, store_scope, granted_by, granted_at
       FROM hrms_permission_grants WHERE tenant_id = $1 ORDER BY grantee_type, grantee_key, permission_id`,
    [tid]
  );
  return r.rows || [];
}

export async function replacePermissionGrants({ tenantId, grants, grantedBy, db = getPool() }) {
  const tid = tenantKey(tenantId);
  const list = Array.isArray(grants) ? grants : [];
  await db.query(`DELETE FROM hrms_permission_grants WHERE tenant_id = $1`, [tid]);
  for (const g of list) {
    const gt = String(g?.grantee_type || g?.granteeType || '').trim();
    const gk = String(g?.grantee_key || g?.granteeKey || '').trim();
    const pid = String(g?.permission_id || g?.permissionId || '').trim();
    const scope = String(g?.store_scope || g?.storeScope || 'inherit').trim() || 'inherit';
    if (!gt || !gk || !pid) continue;
    await db.query(
      `INSERT INTO hrms_permission_grants (tenant_id, grantee_type, grantee_key, permission_id, store_scope, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tid, gt, gk, pid, scope, grantedBy || null]
    );
  }
  return { ok: true, count: list.length };
}

export async function syncPermissionGroupGrants({ tenantId, groups, grantedBy, db = getPool() }) {
  const tid = tenantKey(tenantId);
  await db.query(
    `DELETE FROM hrms_permission_grants WHERE tenant_id = $1 AND grantee_type = 'permission_group'`,
    [tid]
  );
  const list = Array.isArray(groups) ? groups : [];
  let n = 0;
  for (const g of list) {
    const gid = String(g?.id || '').trim();
    const perms = Array.isArray(g?.permissions) ? g.permissions : [];
    for (const pid of perms) {
      const p = String(pid || '').trim();
      if (!gid || !p) continue;
      await db.query(
        `INSERT INTO hrms_permission_grants (tenant_id, grantee_type, grantee_key, permission_id, store_scope, granted_by)
         VALUES ($1, 'permission_group', $2, $3, 'inherit', $4)
         ON CONFLICT (tenant_id, grantee_type, grantee_key, permission_id) DO NOTHING`,
        [tid, gid, p, grantedBy || null]
      );
      n += 1;
    }
  }
  return { ok: true, synced: n };
}

export async function writePermissionAudit({ tenantId, actor, action, detail, db = getPool() }) {
  try {
    await db.query(
      `INSERT INTO hrms_permission_audit_log (tenant_id, actor_username, action, detail) VALUES ($1, $2, $3, $4)`,
      [tenantKey(tenantId), actor || null, String(action || ''), detail && typeof detail === 'object' ? detail : {}]
    );
  } catch (_) {}
}

/** 模块页 → 所需权限（strict/hybrid 前端用） */
export const MODULE_PAGE_PERMISSION = {
  reports: 'module.reports',
  payment: null,
  employees: null,
};

export function modulePageAllowedByPermissions(page, permissions) {
  const p = String(page || '').trim();
  const required = MODULE_PAGE_PERMISSION[p];
  if (!required) return null;
  const set = new Set(Array.isArray(permissions) ? permissions : []);
  return set.has(required) || set.has('*');
}
