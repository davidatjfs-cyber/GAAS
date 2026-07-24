/**
 * Role access gates used by reports / admin-ops / payroll DI.
 * Factory needs normalizeRoleForJwt (not hoisted) for daily-attendance mapping.
 */
export function createRoleAccessHelpers({ normalizeRoleForJwt }) {
  function isAdmin(role) {
    return String(role || '').trim() === 'admin';
  }

  function isHq(role) {
    const r = String(role || '').trim();
    return r === 'hq_manager' || r === 'hr_manager';
  }

  function canAccessAnalyticsReports(role) {
    const r = String(role || '').trim();
    return r === 'admin' || r === 'hq_manager' || r === 'store_manager' || r === 'hr_manager' || r === 'store_production_manager';
  }

  /** 出勤表台账：仅管理员 / 总部营运 / 总部人事（与 JWT 中文/别名角色映射一致） */
  function canAccessDailyAttendanceRegister(role) {
    const r = normalizeRoleForJwt(role);
    return r === 'admin' || r === 'hq_manager' || r === 'hr_manager';
  }

  function canAccessBusinessReports(role) {
    const r = String(role || '').trim();
    return r === 'admin' || r === 'hq_manager' || r === 'store_manager';
  }

  return {
    isAdmin,
    isHq,
    canAccessAnalyticsReports,
    canAccessDailyAttendanceRegister,
    canAccessBusinessReports,
  };
}
