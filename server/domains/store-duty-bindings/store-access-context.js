import {
  buildStoreAccessContext as defaultBuildStoreAccessContext,
  loadActiveDutyRowsForUser as defaultLoadActiveDutyRowsForUser,
} from '../../store-duty-bindings.js';

// Wave H15: getUserStoreAccessContext → DI factory (testable scope/duty merge).
export function createStoreAccessContextHelpers({
  pool,
  getSharedState,
  resolveTenantIdDefault,
  normalizeRoleForJwt,
  resolveStoreScopeStores,
  ensureStoreDutyBindingsReady,
  loadActiveDutyRowsForUser = defaultLoadActiveDutyRowsForUser,
  buildStoreAccessContext = defaultBuildStoreAccessContext,
}) {
  async function getUserStoreAccessContext(username, role, opts = {}) {
    const normalizedUsername = String(username || '').trim();
    const normalizedRole = normalizeRoleForJwt(role);
    const requestedStore = String(opts?.requestedStore || '').trim();
    const stateStore = String(opts?.stateStore || '').trim();
    let dutyRows = [];

    // 权限组/岗位的门店范围（全部/按品牌/按区域/按店多选）优先于跨店绑定表生效；
    // 员工身上有 storeScopeOverride 就优先用它，否则用所在权限组的 storeScope。
    // 员工没分配权限组、或权限组没设门店范围时 resolveStoreScopeStores 返回 null，
    // 直接落到下面 else 分支走原有的跨店绑定查询——对洪潮/马己仙现有数据零影响。
    let scopeStores = null;
    let scopeActions = null;
    if (normalizedUsername) {
      try {
        const tenantId = resolveTenantIdDefault();
        const state = (await getSharedState(tenantId)) || {};
        const employees = Array.isArray(state.employees) ? state.employees : [];
        const emp = employees.find((e) => String(e?.username || '').trim().toLowerCase() === normalizedUsername.toLowerCase());
        const groupId = String(emp?.permissionGroupId || '').trim();
        const group = groupId
          ? (Array.isArray(state.permissionGroups) ? state.permissionGroups : []).find((g) => String(g?.id || '') === groupId)
          : null;
        const effectiveScope = (emp?.storeScopeOverride && typeof emp.storeScopeOverride === 'object')
          ? emp.storeScopeOverride
          : (group?.storeScope || null);
        scopeStores = resolveStoreScopeStores(state, effectiveScope);
        scopeActions = group?.actions && typeof group.actions === 'object' ? group.actions : null;
      } catch (e) {
        scopeStores = null;
      }
    }

    if (Array.isArray(scopeStores)) {
      const primary = stateStore && scopeStores.includes(stateStore) ? stateStore : (scopeStores[0] || '');
      dutyRows = scopeStores.map((store) => ({
        username: normalizedUsername,
        store,
        access_level: store === primary ? 'primary' : 'support',
        is_primary_store: store === primary,
        can_approve_hrms: !!scopeActions?.can_approve_hrms,
        can_view_employees: !!scopeActions?.can_view_employees,
      }));
    } else if (normalizedUsername) {
      try {
        await ensureStoreDutyBindingsReady();
        dutyRows = await loadActiveDutyRowsForUser(pool, normalizedUsername);
      } catch (e) {
        dutyRows = [];
      }
      // 岗位的"动作权限"(可审批HRMS/可查看员工)跟门店范围是否自定义无关，即使门店范围
      // 还是走原有跨店绑定(legacy)，岗位给的动作权限也要叠加生效——用OR不用覆盖，
      // 避免削弱跨店绑定表里已经手动勾好的权限。
      if (scopeActions && (scopeActions.can_approve_hrms || scopeActions.can_view_employees)) {
        dutyRows = dutyRows.map((row) => ({
          ...row,
          can_approve_hrms: !!(row.can_approve_hrms || scopeActions.can_approve_hrms),
          can_view_employees: !!(row.can_view_employees || scopeActions.can_view_employees),
        }));
      }
    }

    return buildStoreAccessContext({
      role: normalizedRole,
      stateStore,
      dutyRows,
      requestedStore,
    });
  }

  return { getUserStoreAccessContext };
}
