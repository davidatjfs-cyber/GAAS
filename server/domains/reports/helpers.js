/**
 * Reports domain helpers + module-level runtime bindings.
 * bindReportsRuntimeDeps(deps) must be called from registerReportsRoutes before sub-routes.
 */
import {
  requireHrmsPermission,
  checkHrmsPermission,
  getTenantEnforcementMode,
  legacyCanAccessAnalyticsReports,
} from '../../services/hrms-permission-engine.js';

export { checkHrmsPermission };

/** 离职日期统一为 YYYY-MM-DD，兼容 2026/4/5、ISO 前缀等，供本月离职判定 */
export function normalizeEmployeeDepartureDateForTurnover(emp) {
  const raw = String(emp?.offboardingDate || emp?.resignedAt || '').trim();
  if (!raw) return '';
  const mIso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mIso) return mIso[1];
  const mSlash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (mSlash) {
    const y = mSlash[1];
    const mo = String(mSlash[2]).padStart(2, '0');
    const d = String(mSlash[3]).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  const mCn = raw.match(/^(\d{4})[年\-](\d{1,2})[月\-](\d{1,2})/);
  if (mCn) {
    return `${mCn[1]}-${String(mCn[2]).padStart(2, '0')}-${String(mCn[3]).padStart(2, '0')}`;
  }
  return '';
}

/** 洪潮「大宁久光店」与「久光店」等双轨店名与报表所选门店对齐 */
export function employeeStoreMatchesTurnoverReportFilter(empStore, reportStore) {
  const rs = String(reportStore || '').trim();
  if (!rs) return true;
  const es = String(empStore || '').trim();
  if (!es) return false;
  return resolveAgentCanonicalStore(es) === resolveAgentCanonicalStore(rs);
}

/** 视为已离职：含 inactive/disabled 且已有离职日期（与账号停用口径一致）；或离职已审批（offboardingApproved）且有离职日期 */
export function isEmployeeDepartedForTurnoverReport(emp) {
  const st = String(emp?.status || '').trim().toLowerCase();
  if (['离职', 'resigned', 'terminated', 'offboarded', 'left', 'departed'].includes(st)) return true;
  if (st === 'inactive' || st === 'disabled') {
    return !!normalizeEmployeeDepartureDateForTurnover(emp);
  }
  const approved = emp?.offboardingApproved === true || emp?.offboardingApproved === 'true' || emp?.offboardingApproved === 1;
  if (approved && normalizeEmployeeDepartureDateForTurnover(emp)) return true;
  return false;
}

/** 视为在职：active/onboard/probation，且未通过离职审批 */
export function isEmployeeActiveLikeForTurnoverReport(emp) {
  const st = String(emp?.status || '').trim().toLowerCase();
  if (!st || st === 'active' || st === 'onboard' || st === 'probation') {
    const approved = emp?.offboardingApproved === true || emp?.offboardingApproved === 'true' || emp?.offboardingApproved === 1;
    if (approved && normalizeEmployeeDepartureDateForTurnover(emp)) return false;
    return true;
  }
  return false;
}

/**
 * 关键人才：与报表 A 区文案一致——① 档案勾选 coreTalent；② 职级 level ≥ 3（数字或可解析数字）；
 * ③ 职务/部门含管理类关键词；④ 店长/总部管理/出品与前厅负责人等 role。
 */
export function isEmployeeCoreTalentForTurnoverReport(emp) {
  if (!emp || typeof emp !== 'object') return false;
  const c = emp.coreTalent;
  if (c === true || c === 'true' || c === 1) return true;

  const lvStr = String(emp.level ?? '').trim();
  if (lvStr) {
    let n = NaN;
    if (/^\d+$/.test(lvStr)) n = parseInt(lvStr, 10);
    else {
      const m = lvStr.match(/^L\s*(\d+)$/i) || lvStr.match(/(\d+)/);
      if (m) n = parseInt(m[1], 10);
    }
    if (Number.isFinite(n) && n >= 3) return true;
  }

  const blob = `${String(emp.position || '')} ${String(emp.department || '')}`;
  if (/经理|主管|店长|总监|负责人|厨师长|副店长|店助|店总|前厅经理|营运|督导|部长|主任|副理|值班经理|副厨|主厨|领班/i.test(blob)) {
    return true;
  }

  const r = String(emp.role || '').trim().toLowerCase();
  if (['store_manager', 'hq_manager', 'store_production_manager', 'front_manager'].includes(r)) return true;

  return false;
}

/** 离职员工是否不应计入指定薪资月。
 *  规则：以员工信息表里的 status 为准（管理员手动改的离职状态优先于 offboardingDate）：
 *  status 非 inactive/离职 → 一律保留（含已审但离职日未到者）；
 *  status=inactive/离职 → 当月有实际出勤才保留（末月结算），无出勤即排除。
 *  不再依赖 offboardingDate，避免审批时填的（可能与实际离职日不一致的）日期导致误判。 */
export function isEmployeeDepartedForPayroll(emp, month, attendanceDays) {
  const m = safeMonthOnly(month);
  if (!m || !emp || typeof emp !== 'object') return false;
  const status = String(emp?.status || '').trim().toLowerCase();
  const inactive = status === 'inactive' || status === '离职';
  if (!inactive) return false;
  if (Number(attendanceDays) > 0) return false; // 已离职但当月有实际出勤 → 末月结算保留
  return true; // 已离职且当月无出勤 → 排除
}

// Module-level bindings needed by the standalone helper functions above
// (they are defined outside registerReportsRoutes, so they close over these).
export let pool;
export let safeMonthOnly;
export let resolveAgentCanonicalStore;
export let getSharedStateRef;

export async function requireReportPerm(req, res, permission, store) {
  return requireHrmsPermission(req, res, permission, {
    store,
    getSharedState: getSharedStateRef,
  });
}

export async function legacyAnalyticsGate(req, res, store) {
  const mode = await getTenantEnforcementMode(req.tenantId || req.user?.tenant_id);
  if (mode !== 'legacy') {
    return requireReportPerm(req, res, 'module.reports', store);
  }
  if (!legacyCanAccessAnalyticsReports(req.user?.role)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

export function bindReportsRuntimeDeps({ pool: poolDep, safeMonthOnly: safeMonthOnlyDep, resolveAgentCanonicalStore: resolveAgentCanonicalStoreDep, getSharedState }) {
  pool = poolDep;
  safeMonthOnly = safeMonthOnlyDep;
  resolveAgentCanonicalStore = resolveAgentCanonicalStoreDep;
  getSharedStateRef = getSharedState;
}
