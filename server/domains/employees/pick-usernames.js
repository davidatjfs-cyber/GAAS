/**
 * pick*Username helpers: resolve role usernames from state, then optional DB fallback.
 * Used by approval DI, promotion recipients, recurring-reward / ops-tasks schedulers.
 */
export function createPickUsernameHelpers({ pool, resolveTenantIdDefault }) {
  async function pickAdminUsername(state) {
    const users = Array.isArray(state?.users) ? state.users : [];
    const employees = Array.isArray(state?.employees) ? state.employees : [];
    // employees first – real users live there
    const all = employees.concat(users);
    const fromState = all.find(x => String(x?.role || '').trim() === 'admin')?.username;
    if (fromState) return String(fromState).trim();

    try {
      // 缺少 tenant_id 过滤会跨租户拿到别的租户的admin用户名，
      // 拿去当审批链assignee用会导致跨租户的人被塞进审批链。
      const r = await pool.query(
        "select username from users where role = 'admin' and is_active = true and tenant_id = $1 order by created_at asc limit 1",
        [resolveTenantIdDefault()]
      );
      const row = r.rows?.[0] || null;
      if (row?.username) return String(row.username).trim();
    } catch (e) { /* ignore */ }

    return 'admin';
  }

  async function pickHqManagerUsername(state) {
    const users = Array.isArray(state?.users) ? state.users : [];
    const employees = Array.isArray(state?.employees) ? state.employees : [];
    // employees first – real users live there; users may contain stale test accounts
    const all = employees.concat(users);
    const fromState = all.find(x => String(x?.role || '').trim() === 'hq_manager' && String(x?.status || '').trim() !== '离职' && String(x?.status || '').trim() !== 'inactive')?.username;
    if (fromState) return String(fromState).trim();

    try {
      // 同 pickAdminUsername：缺少 tenant_id 过滤会跨租户拿到别的租户的hq_manager。
      const r = await pool.query(
        "select username from users where role = 'hq_manager' and is_active = true and tenant_id = $1 order by created_at asc limit 1",
        [resolveTenantIdDefault()]
      );
      const row = r.rows?.[0] || null;
      if (row?.username) return String(row.username).trim();
    } catch (e) { /* ignore */ }

    return '';
  }

  async function pickHrManagerUsername(state) {
    const users = Array.isArray(state?.users) ? state.users : [];
    const employees = Array.isArray(state?.employees) ? state.employees : [];
    // employees first – real users live there
    const all = employees.concat(users);
    const hrRoles = ['hr_manager', 'custom_人事经理'];
    const fromState = all.find(x => hrRoles.includes(String(x?.role || '').trim()) && String(x?.status || '').trim() !== '离职' && String(x?.status || '').trim() !== 'inactive')?.username;
    if (fromState) return String(fromState).trim();
    return '';
  }

  async function pickCashierUsername(state) {
    const users = Array.isArray(state?.users) ? state.users : [];
    const employees = Array.isArray(state?.employees) ? state.employees : [];
    // employees first – real users live there
    const all = employees.concat(users);
    const cashierRoles = ['cashier', 'custom_出纳'];
    const fromState = all.find(x => cashierRoles.includes(String(x?.role || '').trim()) && String(x?.status || '').trim() !== '离职' && String(x?.status || '').trim() !== 'inactive')?.username;
    if (fromState) return String(fromState).trim();

    try {
      const r = await pool.query("select username from users where role = 'cashier' and is_active = true order by created_at asc limit 1");
      const row = r.rows?.[0] || null;
      if (row?.username) return String(row.username).trim();
    } catch (e) { /* ignore */ }

    return '';
  }

  function pickStoreRoleUsernameByStore(state, storeName, roleList) {
    const store = String(storeName || '').trim();
    const roles = Array.isArray(roleList) ? roleList.map(r => String(r || '').trim()) : [];
    if (!store || !roles.length) return '';
    const users = Array.isArray(state?.users) ? state.users : [];
    const employees = Array.isArray(state?.employees) ? state.employees : [];
    const all = employees.concat(users);
    const matches = all.filter(x => {
      const st = String(x?.store || '').trim();
      const rl = String(x?.role || '').trim();
      const status = String(x?.status || '').trim();
      return st === store && roles.includes(rl) && status !== '离职' && status !== 'inactive';
    });
    if (!matches.length) return '';
    if (roles.includes('store_production_manager')) {
      const byTitle = matches.find(x => /出品经理|厨师长/.test(String(x?.position || '')));
      if (byTitle?.username) return String(byTitle.username).trim();
      const lineCookPos = /(炒锅|砧板|打荷|刺身|烧味|卤水|汤档|煲仔)/;
      const nonLine = matches.find(x => !lineCookPos.test(String(x?.position || '')));
      if (nonLine?.username) return String(nonLine.username).trim();
    }
    const found = matches[0];
    return found?.username ? String(found.username).trim() : '';
  }

  return {
    pickAdminUsername,
    pickHqManagerUsername,
    pickHrManagerUsername,
    pickCashierUsername,
    pickStoreRoleUsernameByStore,
  };
}
