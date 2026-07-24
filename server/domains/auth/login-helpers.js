import { resolveUserPermissionContext } from '../../services/hrms-permission-engine.js';

/** 本地开发/DB不可用时的兜底账号 */
export const LOCAL_TEST_ACCOUNTS = [
  { id: 1, username: 'admin', password: 'admin123', name: '系统管理员', role: 'admin' }
];

/**
 * @param {{
 *   getUserStoreAccessContext: Function,
 *   getSharedState: Function,
 * }} deps
 */
export async function buildLoginUserPayload(deps, {
  id, username, name, role, stateStore, permissionGroupId, tenantId, reqLike,
}) {
  const { getUserStoreAccessContext, getSharedState } = deps;
  const ctx = await getUserStoreAccessContext(username, role, {
    requestedStore: stateStore,
    stateStore
  });
  let permCtx = { enforcement_mode: 'legacy', permissions: [] };
  try {
    permCtx = await resolveUserPermissionContext(
      reqLike || {
        tenantId: tenantId || 'default',
        user: {
          username,
          role,
          tenant_id: tenantId || 'default',
          store: stateStore,
          allowed_stores: ctx.allowedStores,
          current_store: ctx.currentStore,
        },
      },
      { getSharedState, permissionGroupId }
    );
  } catch (_) { /* ignore */ }
  return {
    id,
    username,
    name,
    role,
    store: stateStore,
    primary_store: ctx.primaryStore,
    current_store: ctx.currentStore,
    allowed_stores: ctx.allowedStores,
    permission_group_id: permissionGroupId || null,
    enforcement_mode: permCtx.enforcement_mode || 'legacy',
    permissions: Array.isArray(permCtx.permissions) ? permCtx.permissions : [],
  };
}
