/**
 * State client-shaping helpers for GET/PUT /api/state payloads:
 * UTF-8 mojibake repair, password strip, people visibility by role/store.
 *
 * Pure helpers need no DI; strip + visibility need normalizeRoleForJwt /
 * getUserStoreAccessContext / pool via createStateClientShapingHelpers.
 */

// ─── Garbled UTF-8 repair (mojibake: UTF-8 bytes mis-decoded as Latin-1) ─────
export function repairGarbledUtf8(str) {
  if (typeof str !== 'string' || str.length < 2) return str;
  // Quick check: must contain high Latin-1 chars (0xC0-0xFF) typical of mojibake
  if (!/[\u00c0-\u00ff]/.test(str)) return str;
  try {
    const bytes = Buffer.from(str, 'latin1');
    const decoded = bytes.toString('utf8');
    // Valid repair if result contains CJK chars and no replacement chars
    if (/[\u4e00-\u9fff]/.test(decoded) && !decoded.includes('\ufffd')) return decoded;
  } catch (e) { /* ignore */ }
  return str;
}

export function deepRepairGarbledStrings(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return repairGarbledUtf8(obj);
  if (Array.isArray(obj)) return obj.map(deepRepairGarbledStrings);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      out[repairGarbledUtf8(k)] = deepRepairGarbledStrings(obj[k]);
    }
    return out;
  }
  return obj;
}

export function hrmsNormStoreName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** 与前端员工列表一致：离职 / 停用等不在非管理员接口中返回。 */
export function hrmsIsInactiveEmploymentRecord(row) {
  const raw = String(row?.status || '').trim();
  if (!raw) return false;
  const st = raw.toLowerCase();
  if (['inactive', 'resigned', 'terminated', 'deleted', 'left', 'departed'].includes(st)) return true;
  if (/离职|离岗|离退|已删除|已离职|停职|停用/.test(raw)) return true;
  return false;
}

export function createStateClientShapingHelpers({
  normalizeRoleForJwt,
  getUserStoreAccessContext,
  pool,
}) {
  /** GET /api/state 时非 admin 不返回 employees/users 中的明文 password（仅系统管理员可拉取完整副本）。 */
  function stripPasswordFieldsFromStateForClient(data, role) {
    if (!data || typeof data !== 'object') return data;
    if (normalizeRoleForJwt(String(role || '').trim()) === 'admin') return data;
    try {
      const clone = JSON.parse(JSON.stringify(data));
      const wipe = (arr) => {
        if (!Array.isArray(arr)) return;
        for (const it of arr) {
          if (it && typeof it === 'object' && Object.prototype.hasOwnProperty.call(it, 'password')) {
            it.password = '';
          }
        }
      };
      wipe(clone.employees);
      wipe(clone.users);
      return clone;
    } catch (_e) {
      return data;
    }
  }

  /**
   * 裁剪 state 中的 employees / users：
   * - 仅 admin 可看到离职等停用记录；
   * - 店长仅能看到本店（与自身档案或 feishu_users 门店一致）的在册人员。
   */
  async function applyStatePeopleVisibilityForRole(data, role, username, fullStateForLookup, requestedStore) {
    if (!data || typeof data !== 'object') return data;
    const r = normalizeRoleForJwt(String(role || '').trim());
    if (r === 'admin') return data;

    const rawEmps = Array.isArray(data.employees) ? data.employees : [];
    const rawUsers = Array.isArray(data.users) ? data.users : [];
    const lookupAll = []
      .concat(Array.isArray(fullStateForLookup?.employees) ? fullStateForLookup.employees : [])
      .concat(Array.isArray(fullStateForLookup?.users) ? fullStateForLookup.users : []);
    const un = String(username || '').trim().toLowerCase();

    // 用完整名册解析 managerUsername -> managerName，避免门店账号因人员可见性过滤
    // 拿不到总部上级记录时，「我的档案」直属上级只能显示账号代码。
    const nameByUsername = new Map();
    for (const x of lookupAll) {
      const ku = String(x?.username || '').trim().toLowerCase();
      const nm = String(x?.name || '').trim();
      if (ku && nm && !nameByUsername.has(ku)) nameByUsername.set(ku, nm);
    }
    const withMgrName = (row) => {
      if (!row || typeof row !== 'object') return row;
      if (String(row.managerName || '').trim()) return row;
      const mu = String(row.managerUsername || row.manager || '').trim().toLowerCase();
      const nm = mu ? nameByUsername.get(mu) : '';
      return nm ? { ...row, managerName: nm } : row;
    };
    const empsOut = rawEmps.map(withMgrName);
    const usersOut = rawUsers.map(withMgrName);

    let storeScope = null;
    let allowedStores = null;
    if (r === 'store_manager' || r === 'front_manager') {
      const self = lookupAll.find((x) => String(x?.username || '').trim().toLowerCase() === un);
      const stateStore = hrmsNormStoreName(self?.store);
      const ctx = await getUserStoreAccessContext(username, r, {
        requestedStore,
        stateStore
      });
      storeScope = hrmsNormStoreName(ctx.currentStore || stateStore);
      allowedStores = new Set((ctx.allowedStores || []).map((item) => hrmsNormStoreName(item)).filter(Boolean));
    }

    const pass = (row) => {
      if (hrmsIsInactiveEmploymentRecord(row)) return false;
      // Always include the current user's own record regardless of store scope
      if (String(row?.username || '').trim().toLowerCase() === un) return true;
      const rowStore = hrmsNormStoreName(row?.store);
      // 多店兼管（如洪潮店长同时"监管"马己仙门店的 duty binding）时 allowedStores 已包含全部
      // 授权门店；此前额外要求 rowStore === storeScope(主店) 会把非主店的授权门店过滤掉，
      // 导致兼管者在带教人下拉等场景里完全看不到自己有权限的另一家店的员工。
      if (allowedStores && allowedStores.size > 0) return allowedStores.has(rowStore);
      if (storeScope) return rowStore === storeScope;
      return true;
    };

    if ((r === 'store_manager' || r === 'front_manager') && !storeScope) {
      const keepSelf = (row) => String(row?.username || '').trim().toLowerCase() === un;
      return {
        ...data,
        employees: empsOut.filter((row) => keepSelf(row) && !hrmsIsInactiveEmploymentRecord(row)),
        users: usersOut.filter((row) => keepSelf(row) && !hrmsIsInactiveEmploymentRecord(row))
      };
    }

    // Look up the requesting user's authoritative role from the users table.
    // hrms_state.employees role can be stale (overwritten by admin saves); the users table is the source of truth.
    let dbRole = null;
    try {
      const dbRow = await pool.query('SELECT role FROM users WHERE lower(username) = lower($1) LIMIT 1', [un]);
      dbRole = String(dbRow.rows?.[0]?.role || '').trim() || null;
    } catch (_e) { /* ignore */ }

    const filteredEmps = empsOut.filter(pass);
    const filteredUsers = usersOut.filter(pass);

    if (dbRole) {
      return {
        ...data,
        employees: filteredEmps.map(emp =>
          String(emp?.username || '').trim().toLowerCase() === un ? { ...emp, role: dbRole } : emp
        ),
        users: filteredUsers.map(u =>
          String(u?.username || '').trim().toLowerCase() === un ? { ...u, role: dbRole } : u
        )
      };
    }

    return { ...data, employees: filteredEmps, users: filteredUsers };
  }

  return {
    stripPasswordFieldsFromStateForClient,
    applyStatePeopleVisibilityForRole,
    repairGarbledUtf8,
    deepRepairGarbledStrings,
    hrmsNormStoreName,
    hrmsIsInactiveEmploymentRecord,
  };
}
