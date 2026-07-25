/**
 * createApproval 同步校验片段（无 I/O），便于单测与缩短 service-create。
 * 异步校验（payment 重复、promotion track progress 等）仍留在 service-create。
 */

/** @returns {{ error: string, status: number } | null} */
export function validateOnboardingCreate({ role, applicantManager, payload, state, stateFindUserRecord, safeDateOnly }) {
  if (role !== 'store_manager') {
    return { error: 'forbidden', status: 403 };
  }
  if (!applicantManager) {
    return { error: 'missing_manager', status: 400 };
  }
  const emp = payload?.employee && typeof payload.employee === 'object' ? payload.employee : {};
  const newUsername = String(emp?.username || '').trim();
  if (!newUsername) return { error: 'missing_employee_username', status: 400 };
  const joinDate = safeDateOnly(
    emp?.joinDate || emp?.hireDate || emp?.startDate || emp?.entryDate || emp?.onboardDate || emp?.joiningDate
  );
  if (!joinDate) return { error: 'missing_join_date', status: 400 };
  payload.employee = { ...emp, joinDate };
  const exists = stateFindUserRecord(state, newUsername);
  if (exists) return { error: 'employee_username_exists', status: 400 };
  return null;
}

/** @returns {{ error: string, status: number } | null} */
export function validateLeaveCreate({ applicantManager, payload, safeDateOnly }) {
  if (!applicantManager) {
    return { error: 'missing_manager', status: 400 };
  }
  const startDate = safeDateOnly(payload?.startDate || payload?.fromDate || payload?.beginDate);
  const endDate = safeDateOnly(payload?.endDate || payload?.toDate || payload?.finishDate);
  if (!startDate || !endDate) {
    return { error: 'missing_leave_date', status: 400 };
  }
  return null;
}

/**
 * promotion 同步阶段校验（不含 track progress / cross-track 异步）。
 * @returns {{ error: string, status: number } | { ok: true, stage: string } }
 */
export function validatePromotionStageSync({ applicantManager, payload }) {
  if (!applicantManager) {
    return { error: 'missing_manager', status: 400 };
  }
  const stage = String(payload?.promotionStage || 'qualification').trim().toLowerCase();
  if (!['qualification', 'formal'].includes(stage)) {
    return { error: 'invalid_promotion_stage', status: 400 };
  }
  const reason = String(payload?.reason || '').trim();
  if (!reason) return { error: 'missing_reason', status: 400 };
  payload.promotionStage = stage;
  if (stage === 'formal') {
    const trackId = String(payload?.promotionTrackId || '').trim();
    if (!trackId) return { error: 'missing_promotion_track', status: 400 };
  }
  return { ok: true, stage };
}
