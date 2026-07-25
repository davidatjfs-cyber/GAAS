/**
 * L1：统一权限引擎 — legacy/hybrid/strict + grants/audit（mock db）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENFORCEMENT_MODES,
  PERMISSION_CATALOG,
  LEGACY_ROLE_PERMISSIONS,
  legacyRoleHasPermission,
  legacyCanAccessAnalyticsReports,
  legacyCanManagePayrollRules,
  modulePageAllowedByPermissions,
  invalidatePermissionPolicyCache,
  getTenantEnforcementMode,
  setTenantEnforcementMode,
  seedPermissionCatalog,
  seedLegacyRoleGrants,
  resolveUserPermissionContext,
  checkHrmsPermission,
  requireHrmsPermission,
  canAccessAnalyticsReportsForReq,
  canManagePayrollRulesForReq,
  listPermissionGrants,
  replacePermissionGrants,
  syncPermissionGroupGrants,
  writePermissionAudit,
} from '../services/hrms-permission-engine.js';

function mockDb(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params: params || [] });
      return handler(String(sql), params || [], calls.length);
    },
  };
}

test('legacyRoleHasPermission / analytics / payroll rules / module page', () => {
  assert.equal(legacyRoleHasPermission('admin', 'reports.payroll.view'), true);
  assert.equal(legacyRoleHasPermission('store_manager', 'reports.payroll.rules'), false);
  assert.equal(legacyRoleHasPermission('store_manager', 'reports.payroll.view'), true);
  assert.equal(legacyRoleHasPermission('unknown', 'module.reports'), false);
  assert.equal(legacyCanAccessAnalyticsReports('hq_manager'), true);
  assert.equal(legacyCanAccessAnalyticsReports('employee'), false);
  assert.equal(legacyCanManagePayrollRules('hr_manager'), true);
  assert.equal(legacyCanManagePayrollRules('store_manager'), false);
  assert.equal(modulePageAllowedByPermissions('reports', ['module.reports']), true);
  assert.equal(modulePageAllowedByPermissions('reports', []), false);
  assert.equal(modulePageAllowedByPermissions('payment', ['module.reports']), null);
  assert.ok(ENFORCEMENT_MODES.includes('strict'));
  assert.ok(PERMISSION_CATALOG.some((p) => p.id === 'admin.permission_manage'));
  assert.ok(LEGACY_ROLE_PERMISSIONS.admin.includes('*'));
});

test('getTenantEnforcementMode：缓存 + 缺行默认 legacy', async () => {
  invalidatePermissionPolicyCache('t-cache');
  let hits = 0;
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /INSERT INTO hrms_permission_definitions/i.test(sql)) {
      return { rows: [] };
    }
    if (/FROM hrms_permission_policies/i.test(sql)) {
      hits += 1;
      return { rows: [{ enforcement_mode: 'hybrid' }] };
    }
    return { rows: [] };
  });
  assert.equal(await getTenantEnforcementMode('t-cache', db), 'hybrid');
  assert.equal(await getTenantEnforcementMode('t-cache', db), 'hybrid');
  assert.equal(hits, 1); // TTL 缓存命中

  invalidatePermissionPolicyCache('t-empty');
  const db2 = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /INSERT INTO hrms_permission_definitions/i.test(sql)) return { rows: [] };
    if (/FROM hrms_permission_policies/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  assert.equal(await getTenantEnforcementMode('t-empty', db2), 'legacy');
});

test('setTenantEnforcementMode：非法 mode / hybrid 触发 seed', async () => {
  const bad = await setTenantEnforcementMode({
    tenantId: 't1',
    mode: 'nope',
    db: mockDb(async () => ({ rows: [] })),
  });
  assert.deepEqual(bad, { ok: false, error: 'invalid_mode' });

  const db = mockDb(async (sql) => ({ rows: [] }));
  const ok = await setTenantEnforcementMode({
    tenantId: 't-hybrid',
    mode: 'hybrid',
    updatedBy: 'boss',
    db,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.enforcement_mode, 'hybrid');
  assert.ok(db.calls.some((c) => /INSERT INTO hrms_permission_policies/i.test(c.sql)));
  assert.ok(db.calls.some((c) => /INSERT INTO hrms_permission_grants/i.test(c.sql)));
});

test('seedPermissionCatalog / seedLegacyRoleGrants / list / replace / sync / audit', async () => {
  const db = mockDb(async () => ({ rows: [] }));
  await seedPermissionCatalog('t-seed', db);
  assert.ok(db.calls.some((c) => /INSERT INTO hrms_permission_definitions/i.test(c.sql)));
  assert.ok(db.calls.length >= PERMISSION_CATALOG.length);

  const grantDb = mockDb(async () => ({ rows: [] }));
  await seedLegacyRoleGrants('t-seed', 'sys', grantDb);
  assert.ok(grantDb.calls.some((c) => c.params.includes('store_manager')));
  assert.ok(grantDb.calls.some((c) => c.params.includes('admin')));

  const listDb = mockDb(async () => ({
    rows: [{ grantee_type: 'role', grantee_key: 'admin', permission_id: 'module.reports' }],
  }));
  const listed = await listPermissionGrants('t-seed', listDb);
  assert.equal(listed.length, 1);

  const replDb = mockDb(async () => ({ rows: [] }));
  const replaced = await replacePermissionGrants({
    tenantId: 't-seed',
    grants: [
      { granteeType: 'user', granteeKey: 'alice', permissionId: 'module.reports', storeScope: 'all' },
      { grantee_type: '', grantee_key: 'x', permission_id: 'y' }, // skip
    ],
    grantedBy: 'boss',
    db: replDb,
  });
  assert.equal(replaced.ok, true);
  assert.ok(replDb.calls.some((c) => /DELETE FROM hrms_permission_grants/i.test(c.sql)));
  assert.ok(replDb.calls.some((c) => /INSERT INTO hrms_permission_grants/i.test(c.sql)));

  const syncDb = mockDb(async () => ({ rows: [] }));
  const synced = await syncPermissionGroupGrants({
    tenantId: 't-seed',
    groups: [{ id: 'g1', permissions: ['module.reports', ''] }],
    grantedBy: 'boss',
    db: syncDb,
  });
  assert.equal(synced.synced, 1);

  await writePermissionAudit({
    tenantId: 't-seed',
    actor: 'boss',
    action: 'set_mode',
    detail: { mode: 'strict' },
    db: mockDb(async () => ({ rows: [] })),
  });
  await writePermissionAudit({
    tenantId: 't-seed',
    actor: 'boss',
    action: 'noop',
    db: mockDb(async () => {
      throw new Error('audit_down');
    }),
  });
});

test('resolveUserPermissionContext：legacy / hybrid 显式授权 / 权限组', async () => {
  invalidatePermissionPolicyCache('t-legacy');
  const legacyDb = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /INSERT INTO hrms_permission_definitions/i.test(sql)) return { rows: [] };
    if (/FROM hrms_permission_policies/i.test(sql)) return { rows: [{ enforcement_mode: 'legacy' }] };
    return { rows: [] };
  });
  const legacyCtx = await resolveUserPermissionContext(
    { user: { username: 'alice', role: 'store_manager', tenant_id: 't-legacy' } },
    { db: legacyDb }
  );
  assert.equal(legacyCtx.enforcement_mode, 'legacy');
  assert.ok(legacyCtx.permissions.includes('reports.payroll.view'));
  assert.equal(legacyCtx.permissions.includes('reports.payroll.rules'), false);

  invalidatePermissionPolicyCache('t-hyb');
  const hybDb = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /INSERT INTO hrms_permission_definitions/i.test(sql)) return { rows: [] };
    if (/FROM hrms_permission_policies/i.test(sql)) return { rows: [{ enforcement_mode: 'hybrid' }] };
    if (/FROM hrms_permission_grants/i.test(sql)) {
      return { rows: [{ permission_id: 'reports.payroll.rules' }] };
    }
    return { rows: [] };
  });
  const hybCtx = await resolveUserPermissionContext(
    { user: { username: 'bob', role: 'store_manager', tenant_id: 't-hyb' } },
    {
      db: hybDb,
      getSharedState: async () => ({
        employees: [{ username: 'bob', permissionGroupId: 'g-extra' }],
        permissionGroups: [{ id: 'g-extra', permissions: ['reports.payroll.export'] }],
      }),
    }
  );
  assert.equal(hybCtx.enforcement_mode, 'hybrid');
  assert.ok(hybCtx.permissions.includes('reports.payroll.view')); // legacy
  assert.ok(hybCtx.permissions.includes('reports.payroll.rules')); // explicit
  assert.ok(hybCtx.permissions.includes('reports.payroll.export')); // group
  assert.equal(hybCtx.permission_group_id, 'g-extra');
});

test('checkHrmsPermission / requireHrmsPermission / store scope', async () => {
  invalidatePermissionPolicyCache('t-chk');
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /INSERT INTO hrms_permission_definitions/i.test(sql)) return { rows: [] };
    if (/FROM hrms_permission_policies/i.test(sql)) return { rows: [{ enforcement_mode: 'legacy' }] };
    return { rows: [] };
  });
  const req = {
    tenantId: 't-chk',
    user: {
      username: 'mgr',
      role: 'store_manager',
      allowed_stores: ['洪潮'],
      store: '洪潮',
    },
  };
  assert.equal((await checkHrmsPermission(req, '', { db })).reason, 'missing_permission');
  const ok = await checkHrmsPermission(req, 'reports.payroll.view', { db, store: '洪潮' });
  assert.equal(ok.ok, true);
  const denied = await checkHrmsPermission(req, 'reports.payroll.rules', { db });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'permission_denied');
  const storeDenied = await checkHrmsPermission(req, 'reports.payroll.view', { db, store: '马己仙' });
  assert.equal(storeDenied.reason, 'store_scope_denied');

  let status = 0;
  let body = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
    },
  };
  assert.equal(await requireHrmsPermission(req, res, 'reports.payroll.rules', { db }), false);
  assert.equal(status, 403);
  assert.equal(body.error, 'forbidden');
  assert.equal(await requireHrmsPermission(req, res, 'reports.payroll.view', { db }), true);

  // 无 allowed_stores 时按 user.store 校验门店范围
  const req2 = {
    tenantId: 't-chk',
    user: { username: 'mgr2', role: 'store_manager', store: '洪潮' },
  };
  assert.equal(
    (await checkHrmsPermission(req2, 'reports.payroll.view', { db, store: '洪潮' })).ok,
    true
  );
  assert.equal(
    (await checkHrmsPermission(req2, 'reports.payroll.view', { db, store: '马己仙' })).reason,
    'store_scope_denied'
  );
});

test('resolveUserPermissionContext：admin * 展开目录；policy 查询失败 → legacy', async () => {
  invalidatePermissionPolicyCache('t-admin');
  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /INSERT INTO hrms_permission_definitions/i.test(sql)) return { rows: [] };
    if (/FROM hrms_permission_policies/i.test(sql)) return { rows: [{ enforcement_mode: 'legacy' }] };
    return { rows: [] };
  });
  const ctx = await resolveUserPermissionContext(
    { user: { username: 'root', role: 'admin', tenant_id: 't-admin' } },
    { db }
  );
  assert.ok(ctx.permissions.includes('admin.permission_manage'));
  assert.equal(ctx.permissions.length, PERMISSION_CATALOG.length);

  invalidatePermissionPolicyCache('t-fail');
  const failDb = mockDb(async () => {
    throw new Error('db_down');
  });
  assert.equal(await getTenantEnforcementMode('t-fail', failDb), 'legacy');
});

test('canAccessAnalyticsReportsForReq / canManagePayrollRulesForReq', async () => {
  invalidatePermissionPolicyCache('t-wrap');
  const legacyDb = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /INSERT INTO hrms_permission_definitions/i.test(sql)) return { rows: [] };
    if (/FROM hrms_permission_policies/i.test(sql)) return { rows: [{ enforcement_mode: 'legacy' }] };
    return { rows: [] };
  });
  assert.equal(
    await canAccessAnalyticsReportsForReq(
      { user: { role: 'store_manager', tenant_id: 't-wrap' } },
      { db: legacyDb }
    ),
    true
  );
  assert.equal(
    await canManagePayrollRulesForReq(
      { user: { role: 'store_manager', tenant_id: 't-wrap' } },
      { db: legacyDb }
    ),
    false
  );

  invalidatePermissionPolicyCache('t-strict');
  const strictDb = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /INSERT INTO hrms_permission_definitions/i.test(sql)) return { rows: [] };
    if (/FROM hrms_permission_policies/i.test(sql)) return { rows: [{ enforcement_mode: 'strict' }] };
    if (/FROM hrms_permission_grants/i.test(sql)) {
      return { rows: [{ permission_id: 'module.reports' }] };
    }
    return { rows: [] };
  });
  assert.equal(
    await canAccessAnalyticsReportsForReq(
      { user: { username: 'u1', role: 'employee', tenant_id: 't-strict' } },
      { db: strictDb }
    ),
    true
  );
  assert.equal(
    await canManagePayrollRulesForReq(
      { user: { username: 'u1', role: 'employee', tenant_id: 't-strict' } },
      { db: strictDb }
    ),
    false
  );
});
