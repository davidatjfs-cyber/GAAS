/**
 * Role code normalization for JWT / users-table CHECK.
 * Named exports — no factory.
 */

// users 表 role 列有 CHECK 约束，只允许 admin/hq_manager/store_manager/hq_employee/store_employee 5种，
// normalizeRoleForJwt() 的输出可能是 cashier/hr_manager 等更细的角色（登录时另外从 hrms_state 同步真实权限），
// 写 users 表时需要先收窄到约束允许的范围，避免 INSERT 因 CHECK 失败。
export function normalizeUsersTableRole(input) {
  const jwtRole = normalizeRoleForJwt(input);
  const allowed = ['admin', 'hq_manager', 'store_manager', 'hq_employee', 'store_employee'];
  if (allowed.includes(jwtRole)) return jwtRole;
  return 'store_employee';
}

export function normalizeRoleForJwt(input) {
  const v = String(input || '').trim();
  if (!v) return 'store_employee';
  const allowed = ['admin', 'hq_manager', 'store_manager', 'store_employee', 'cashier', 'hr_manager', 'store_production_manager', 'front_manager'];
  if (allowed.includes(v)) return v;
  // Map known Chinese/custom role names to standard codes（与前端 hrmsNormalizeRoleCode 对齐，避免 JWT 为 custom_管理员 时服务端仍按非 admin 处理）
  const map = {
    管理员: 'admin',
    系统管理员: 'admin',
    custom_管理员: 'admin',
    custom_系统管理员: 'admin',
    总部管理层: 'hq_manager',
    总部经理: 'hq_manager',
    custom_总部经理: 'hq_manager',
    custom_总部营运: 'hq_manager',
    custom_总部管理层: 'hq_manager',
    总部营运: 'hq_manager',
    总部人员: 'hr_manager',
    总部人事: 'hr_manager',
    custom_总部人员: 'hr_manager',
    custom_总部人事: 'hr_manager',
    custom_人事经理: 'hr_manager',
    人事经理: 'hr_manager',
    出纳: 'cashier',
    总部出纳: 'cashier',
    custom_出纳: 'cashier',
    门店店长: 'store_manager',
    店长: 'store_manager',
    custom_门店店长: 'store_manager',
    custom_店长: 'store_manager',
    门店出品经理: 'store_production_manager',
    出品经理: 'store_production_manager',
    custom_门店出品经理: 'store_production_manager',
    custom_出品经理: 'store_production_manager',
    store_product_manager: 'store_production_manager',
    门店员工: 'store_employee',
    员工: 'store_employee'
  };
  if (map[v]) return map[v];
  if (v.startsWith('custom_')) {
    const raw = v.slice(7);
    if (map[raw]) return map[raw];
    if (/管理员/.test(raw)) return 'admin';
    if (/总部|营运/.test(raw)) return 'hq_manager';
    if (/人事|hr/i.test(raw)) return 'hr_manager';
    if (/店长/.test(raw)) return 'store_manager';
    if (/出品/.test(raw)) return 'store_production_manager';
    if (/出纳|财务/.test(raw)) return 'cashier';
    return 'store_employee';
  }
  return map[v] || v;
}
