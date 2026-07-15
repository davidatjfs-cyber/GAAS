/**
 * 租户 RBAC 管理 API
 */
import {
  ensurePermissionTables,
  seedPermissionCatalog,
  getTenantEnforcementMode,
  setTenantEnforcementMode,
  listPermissionGrants,
  replacePermissionGrants,
  syncPermissionGroupGrants,
  resolveUserPermissionContext,
  PERMISSION_CATALOG,
  writePermissionAudit,
  checkHrmsPermission,
  ENFORCEMENT_MODES,
} from './services/hrms-permission-engine.js';

export function registerHrmsPermissionRoutes(app, deps = {}) {
  const {
    pool,
    authRequired,
    getSharedState,
    saveSharedState,
    isAdmin,
  } = deps;

  const db = typeof pool === 'function' ? pool() : pool;

  function tenantOf(req) {
    return String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
  }

  async function assertPermissionAdmin(req, res) {
    const role = String(req.user?.role || '').trim();
    if (isAdmin?.(role)) return true;
    const mode = await getTenantEnforcementMode(tenantOf(req), db);
    if (mode === 'legacy') return false;
    return checkHrmsPermission(req, 'admin.permission_manage', { db, getSharedState }).then((r) => r.ok);
  }

  app.get('/api/hrms/permissions/catalog', authRequired, async (req, res) => {
    try {
      const tid = tenantOf(req);
      await ensurePermissionTables(db);
      await seedPermissionCatalog(tid, db);
      const defs = await db.query(
        `SELECT permission_id, category, label_zh, description_zh, sensitive
           FROM hrms_permission_definitions WHERE tenant_id = $1 ORDER BY category, permission_id`,
        [tid]
      );
      return res.json({
        catalog: defs.rows?.length ? defs.rows : PERMISSION_CATALOG,
        enforcement_modes: ENFORCEMENT_MODES,
      });
    } catch (e) {
      console.error('[permissions/catalog]', e?.message);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/hrms/permissions/me', authRequired, async (req, res) => {
    try {
      const ctx = await resolveUserPermissionContext(req, { db, getSharedState });
      return res.json(ctx);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/hrms/permissions/policy', authRequired, async (req, res) => {
    try {
      if (!(await assertPermissionAdmin(req, res))) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const tid = tenantOf(req);
      const mode = await getTenantEnforcementMode(tid, db);
      const grants = await listPermissionGrants(tid, db);
      return res.json({ enforcement_mode: mode, grants });
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.put('/api/hrms/permissions/policy', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (!isAdmin?.(role)) return res.status(403).json({ error: 'admin_only' });
      const tid = tenantOf(req);
      const mode = String(req.body?.enforcement_mode || req.body?.enforcementMode || '').trim();
      const result = await setTenantEnforcementMode({
        tenantId: tid,
        mode,
        updatedBy: req.user?.username,
        db,
      });
      if (!result.ok) return res.status(400).json(result);
      await writePermissionAudit({
        tenantId: tid,
        actor: req.user?.username,
        action: 'policy_update',
        detail: { enforcement_mode: mode },
        db,
      });
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.put('/api/hrms/permissions/grants', authRequired, async (req, res) => {
    try {
      if (!(await assertPermissionAdmin(req, res))) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const tid = tenantOf(req);
      const grants = Array.isArray(req.body?.grants) ? req.body.grants : [];
      const result = await replacePermissionGrants({
        tenantId: tid,
        grants,
        grantedBy: req.user?.username,
        db,
      });
      await writePermissionAudit({
        tenantId: tid,
        actor: req.user?.username,
        action: 'grants_replace',
        detail: { count: grants.length },
        db,
      });
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });

  // 保存权限组时同步 DB grants（strict/hybrid 生效）
  app.post('/api/hrms/permissions/sync-groups', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (!isAdmin?.(role)) return res.status(403).json({ error: 'admin_only' });
      const tid = tenantOf(req);
      const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
      const result = await syncPermissionGroupGrants({
        tenantId: tid,
        groups,
        grantedBy: req.user?.username,
        db,
      });
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error' });
    }
  });
}
