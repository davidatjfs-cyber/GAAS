import { syncPermissionGroupGrants } from '../../services/hrms-permission-engine.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'permission-groups', handler: 'routes' });


/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: any,
 *   getSharedState: (tenantId?: string) => Promise<any>,
 *   saveSharedState: (state: any, tenantId?: string) => Promise<void>,
 *   mergeSharedStateFields: (patch: any, mergeKeys: any, tenantId?: string) => Promise<void>,
 * }} deps
 */
export function registerPermissionGroupsRoutes(app, authRequired, deps) {
  const { pool, getSharedState, saveSharedState, mergeSharedStateFields } = deps;

  // ─── 权限组 API：同一角色/岗位下不同员工可分配不同模块权限（按租户隔离） ──────────
  app.get('/api/permission-groups', authRequired, async (req, res) => {
    try {
      const state = (await getSharedState(req.tenantId)) || {};
      return res.json({ groups: Array.isArray(state.permissionGroups) ? state.permissionGroups : [] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.put('/api/permission-groups', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    try {
      const groups = req.body?.groups;
      if (!Array.isArray(groups)) return res.status(400).json({ error: 'invalid_groups' });
      const state = (await getSharedState(req.tenantId)) || {};
      state.permissionGroups = groups;
      await saveSharedState(state, req.tenantId);
      try {
        await syncPermissionGroupGrants({
          tenantId: req.tenantId || req.user?.tenant_id || 'default',
          groups,
          grantedBy: req.user?.username,
          db: pool,
        });
      } catch (syncErr) {
        log.warn({ msg: 'permission_groups_grant_sync_failed_non_fatal', err: syncErr?.message });
      }
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // 把一批员工分配到某个权限组（groupId 传空字符串=取消分配，回退到角色默认权限）
  app.post('/api/permission-groups/assign', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    try {
      // groupId / storeScopeOverride 都是可选的——不传(字段缺省)就不动那个字段，
      // 这样可以单独"只改门店范围、不改权限组分配"（同一岗位的督导各管不同门店）。
      const hasGroupId = Object.prototype.hasOwnProperty.call(req.body || {}, 'groupId');
      const groupId = hasGroupId ? String(req.body?.groupId || '').trim() : undefined;
      const hasStoreScope = Object.prototype.hasOwnProperty.call(req.body || {}, 'storeScopeOverride');
      const storeScopeOverride = hasStoreScope
        ? (req.body?.storeScopeOverride && typeof req.body.storeScopeOverride === 'object' ? req.body.storeScopeOverride : null)
        : undefined;
      const usernames = Array.isArray(req.body?.usernames)
        ? req.body.usernames.map(u => String(u || '').trim().toLowerCase()).filter(Boolean)
        : [];
      if (!usernames.length) return res.status(400).json({ error: 'missing_usernames' });
      if (!hasGroupId && !hasStoreScope) return res.status(400).json({ error: 'nothing_to_update' });
      const state = (await getSharedState(req.tenantId)) || {};
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const updates = [];
      for (const uname of usernames) {
        const emp = employees.find(e => String(e?.username || '').trim().toLowerCase() === uname);
        if (!emp) continue;
        const next = { ...emp };
        if (hasGroupId) next.permissionGroupId = groupId || null;
        if (hasStoreScope) next.storeScopeOverride = storeScopeOverride;
        updates.push(next);
      }
      if (updates.length) {
        await mergeSharedStateFields({ employees: updates }, { employees: 'username' }, req.tenantId);
      }
      return res.json({ ok: true, updated: updates.length });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
