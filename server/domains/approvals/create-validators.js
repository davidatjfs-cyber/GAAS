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

/** payment 字段同步校验（不含 DB 重复检查） */
export function validatePaymentFieldsSync({
  role,
  payload,
  applicant,
  allowedStores,
  safeDateOnly,
  safeNumber,
}) {
  if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager' || role === 'cashier' || role === 'front_manager')) {
    return { error: 'forbidden', status: 403 };
  }
  const store = String(payload?.store || '').trim();
  const date = safeDateOnly(payload?.date || payload?.applyDate || payload?.requestDate);
  const amount = safeNumber(payload?.amount);
  const category = String(payload?.category || payload?.project || '').trim();
  if (!store) return { error: 'missing_store', status: 400 };
  if (role === 'front_manager') {
    const ownStore = String(applicant?.store || '').trim();
    const allowed = Array.isArray(allowedStores)
      ? allowedStores.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const allowedSet = new Set([ownStore, ...allowed].filter(Boolean));
    if (allowedSet.size && !allowedSet.has(store)) {
      return { error: 'store_not_allowed', status: 403 };
    }
  }
  if (!date) return { error: 'missing_date', status: 400 };
  if (amount == null || amount <= 0) return { error: 'missing_amount', status: 400 };
  if (!category) return { error: 'missing_category', status: 400 };
  return { ok: true, store, date, amount, category };
}

/** reward_punishment 同步校验 */
export function validateRewardPunishmentSync({
  role,
  payload,
  recurringFrequencyReward,
  state,
  stateFindUserRecord,
  safeNumber,
}) {
  if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager')) {
    return { error: 'forbidden', status: 403 };
  }
  const targetUsername = String(payload?.targetUsername || payload?.employeeUsername || '').trim();
  const reason = String(payload?.reason || '').trim();
  const result = String(payload?.result || '').trim();
  const amount = safeNumber(payload?.amount);
  if (!targetUsername) return { error: 'missing_target', status: 400 };
  if (!reason) return { error: 'missing_reason', status: 400 };
  if (!result) return { error: 'missing_result', status: 400 };
  if (amount == null || amount <= 0) return { error: 'missing_amount', status: 400 };
  const tgtRec = stateFindUserRecord(state, targetUsername) || {};
  if (!String(payload?.store || '').trim() && String(tgtRec?.store || '').trim()) {
    payload.store = String(tgtRec.store).trim();
  }
  if (recurringFrequencyReward && recurringFrequencyReward !== 'monthly') {
    return { error: 'invalid_recurring_frequency', status: 400 };
  }
  if (recurringFrequencyReward === 'monthly') {
    const rpT0 = String(payload?.rpType || '').trim();
    if (!(rpT0 === '奖励' || rpT0 === 'reward')) {
      return { error: 'recurring_reward_only', status: 400 };
    }
  }
  return null;
}

/**
 * points 条目/单条同步校验（不含 daily_limit DB 检查）。
 * @returns {{ error: string, status: number, message?: string } | null}
 */
export function validatePointsPayloadSync({
  role,
  applicantManager,
  applicant,
  username,
  payload,
  state,
  safeNumber,
}) {
  if (!(role === 'store_employee' || role === 'employee' || role === 'front_manager' || role === 'front_supervisor' || role === 'store_production_manager')) {
    return { error: 'forbidden', status: 403 };
  }
  if (!applicantManager) {
    return { error: 'missing_manager', status: 400 };
  }
  const applicantStore = String(applicant?.store || '').trim();
  if (!applicantStore) return { error: 'missing_store', status: 400 };

  const rules = Array.isArray(state?.pointRules) ? state.pointRules : [];
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  if (rawItems.length > 0) {
    if (rawItems.length > 20) return { error: 'too_many_items', status: 400, message: '单次最多申请20条' };
    const validatedItems = [];
    let totalPoints = 0;
    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const rid = String(it?.ruleId || '').trim();
      const rsn = String(it?.reason || '').trim();
      if (!rid) return { error: 'missing_rule', status: 400, message: `第${i + 1}条缺少事项` };
      if (!rsn) return { error: 'missing_reason', status: 400, message: `第${i + 1}条缺少理由` };
      const rule = rules.find((r) => String(r?.id || '').trim() === rid);
      if (!rule) return { error: 'invalid_rule', status: 400, message: `第${i + 1}条事项无效` };
      if (rule?.enabled === false) return { error: 'invalid_rule', status: 400, message: `第${i + 1}条事项已禁用` };
      const ruleStore = String(rule?.store || '').trim();
      if (ruleStore && ruleStore !== applicantStore) {
        return { error: 'rule_store_mismatch', status: 400, message: `第${i + 1}条事项门店不匹配` };
      }
      const rulePoints = safeNumber(rule?.points);
      if (rulePoints == null || rulePoints <= 0) {
        return { error: 'invalid_rule_points', status: 400, message: `第${i + 1}条积分无效` };
      }
      validatedItems.push({
        ruleId: rid,
        itemName: String(rule?.itemName || '').trim() || '积分事项',
        points: rulePoints,
        reason: rsn,
      });
      totalPoints += rulePoints;
    }
    payload.items = validatedItems;
    payload.totalPoints = totalPoints;
    payload.points = totalPoints;
    payload.itemName = validatedItems.length === 1
      ? validatedItems[0].itemName
      : `${validatedItems.length}项积分申请（共${totalPoints}分）`;
  } else {
    const ruleId = String(payload?.ruleId || '').trim();
    const reason = String(payload?.reason || '').trim();
    if (!ruleId) return { error: 'missing_rule', status: 400 };
    if (!reason) return { error: 'missing_reason', status: 400 };
    const rule = rules.find((r) => String(r?.id || '').trim() === ruleId);
    if (!rule) return { error: 'invalid_rule', status: 400 };
    if (rule?.enabled === false) return { error: 'rule_disabled', status: 400 };
    const ruleStore = String(rule?.store || '').trim();
    if (ruleStore && ruleStore !== applicantStore) return { error: 'rule_store_mismatch', status: 400 };
    const rulePoints = safeNumber(rule?.points);
    if (rulePoints == null || rulePoints <= 0) return { error: 'invalid_rule_points', status: 400 };
    payload.itemName = String(rule?.itemName || payload?.itemName || '').trim() || '积分事项';
    payload.points = rulePoints;
    payload.ruleId = ruleId;
  }
  payload.store = applicantStore;
  payload.applicantName = String(applicant?.name || '').trim() || username;
  payload.applicantPosition = String(applicant?.position || '').trim() || '';
  payload.applicantDepartment = String(applicant?.department || '').trim() || '';
  payload.applicantLevel = String(applicant?.level || '').trim() || '';
  payload.evidenceUrls = Array.isArray(payload?.evidenceUrls)
    ? payload.evidenceUrls.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  return null;
}
