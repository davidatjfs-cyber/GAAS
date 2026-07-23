/**
 * 从入职审批 payload.employee 生成待写入 hrms_state.employees 的记录（与 decide 终审逻辑一致）。
 * hrmsNowISO 经 bindOnboardingPayloadDeps 注入（与 daily-reports helpers 同模式）。
 */

let _hrmsNowISO = null;

export function bindOnboardingPayloadDeps(deps = {}) {
  if (typeof deps.hrmsNowISO === 'function') _hrmsNowISO = deps.hrmsNowISO;
}

/**
 * @returns {{ ok: true, nextEmp: object, newUsername: string, empName: string, empPassword: string } | { ok: false, reason: string, nextEmp: null }}
 */
export function buildOnboardingEmployeeRecordFromPayload(emp, stateForId) {
  const nowFn = typeof _hrmsNowISO === 'function' ? _hrmsNowISO : () => new Date().toISOString();
  const employees = Array.isArray(stateForId?.employees) ? stateForId.employees : [];
  const newUsername = String(emp?.username || '').trim();
  if (!newUsername) return { ok: false, reason: 'missing_employee_username', nextEmp: null };
  let empId = String(emp?.id || '').trim();
  if (!empId) {
    let maxNum = 0;
    employees.forEach(e => {
      const eid = String(e?.id || '').trim();
      const m = eid.match(/^(?:EMP)?(\d+)$/i);
      if (m) { const n = Number(m[1]); if (n > maxNum) maxNum = n; }
    });
    empId = String(maxNum + 1).padStart(4, '0');
  }
  const empPassword = String(emp?.password || '').trim() || '123456';
  const empName = String(emp?.name || '').trim() || newUsername;
  const nextEmp = {
    id: empId,
    username: newUsername,
    name: empName,
    password: empPassword,
    gender: String(emp?.gender || '').trim() || '',
    birthday: String(emp?.birthday || '').trim() || '',
    idCardNumber: String(emp?.idCardNumber || emp?.idCardNo || emp?.idNumber || '').trim() || '',
    hometown: String(emp?.hometown || '').trim() || '',
    registeredResidence: String(emp?.registeredResidence || '').trim() || '',
    maritalStatus: String(emp?.maritalStatus || '').trim() || '',
    wechat: String(emp?.wechat || '').trim() || '',
    store: String(emp?.store || '').trim() || '',
    role: String(emp?.role || '').trim() || 'store_employee',
    department: String(emp?.department || '').trim() || '',
    position: String(emp?.position || '').trim() || '',
    level: String(emp?.level || '').trim() || '',
    managerUsername: String(emp?.managerUsername || '').trim() || '',
    salary: emp?.salary == null ? '' : emp.salary,
    education: String(emp?.education || '').trim() || '',
    bankCard: String(emp?.bankCard || '').trim() || '',
    emergencyContactName: String(emp?.emergencyContactName || '').trim() || '',
    emergencyContactPhone: String(emp?.emergencyContactPhone || '').trim() || '',
    emergencyContactRelation: String(emp?.emergencyContactRelation || '').trim() || '',
    idCardFrontUrl: String(emp?.idCardFrontUrl || '').trim() || '',
    idCardBackUrl: String(emp?.idCardBackUrl || '').trim() || '',
    joinDate: String(emp?.joinDate || '').trim() || '',
    phone: String(emp?.phone || '').trim() || '',
    email: String(emp?.email || '').trim() || '',
    status: 'active',
    promotionHistory: Array.isArray(emp?.promotionHistory) ? emp.promotionHistory : [],
    createdAt: nowFn().slice(0, 10),
    lastLogin: null
  };
  return { ok: true, nextEmp, newUsername, empName, empPassword };
}
