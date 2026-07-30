/**
 * 修复「晋升资格已批准且已派发培训任务，但 promotionTracks 丢失」的孤儿记录。
 * 根因：资格终审后曾先写 training_assignments / 通知，再 merge track；中间抛错会被
 * afterDecide 静默吞掉，导致正式晋升下拉里「暂无可申请记录」。
 */

/**
 * @param {object} opts
 * @param {import('pg').Pool} opts.pool
 * @param {object[]} opts.existingTracks
 * @param {() => string} opts.hrmsNowISO
 * @returns {Promise<object[]>} 需要写回 state 的 track 列表（仅孤儿）
 */
export async function buildOrphanPromotionTracks({ pool, existingTracks, hrmsNowISO }) {
  const existing = Array.isArray(existingTracks) ? existingTracks : [];
  const existingIds = new Set(existing.map((t) => String(t?.id || '').trim()).filter(Boolean));
  const existingApprovalIds = new Set(
    existing.map((t) => String(t?.approvalId || '').trim()).filter(Boolean)
  );

  const orphanAssign = await pool.query(
    `SELECT a.related_track_id::text AS track_id,
            a.employee_username,
            array_agg(DISTINCT a.topic_id) AS topic_ids,
            min(a.due_date)::text AS due_date,
            min(a.created_at) AS created_at
     FROM training_assignments a
     WHERE a.source = 'promotion_qualification'
       AND a.related_track_id IS NOT NULL
     GROUP BY a.related_track_id, a.employee_username`
  );

  const orphans = (orphanAssign.rows || []).filter(
    (r) => r.track_id && !existingIds.has(String(r.track_id))
  );
  if (!orphans.length) return [];

  const healed = [];
  for (const row of orphans) {
    const username = String(row.employee_username || '').trim();
    const trackId = String(row.track_id || '').trim();
    if (!username || !trackId) continue;

    const ar = await pool.query(
      `SELECT id, applicant_username, payload, created_at, updated_at
       FROM approval_requests
       WHERE type = 'promotion'
         AND status = 'approved'
         AND lower(applicant_username) = lower($1)
         AND lower(coalesce(payload->>'promotionStage', 'qualification')) = 'qualification'
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 5`,
      [username]
    );
    const approval =
      (ar.rows || []).find((a) => !existingApprovalIds.has(String(a.id || ''))) || ar.rows?.[0];
    if (!approval) continue;
    if (existingApprovalIds.has(String(approval.id || ''))) continue;

    const payload = approval.payload && typeof approval.payload === 'object' ? approval.payload : {};
    const topicIds = Array.isArray(row.topic_ids)
      ? row.topic_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const selected = Array.isArray(payload.selectedTopicIds)
      ? payload.selectedTopicIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const requiredTopicIds = topicIds.length ? topicIds : selected;
    const createdAt =
      (row.created_at && new Date(row.created_at).toISOString()) ||
      (approval.updated_at && new Date(approval.updated_at).toISOString()) ||
      hrmsNowISO();

    const empR = await pool.query(
      `SELECT name, role, position, store, department
       FROM employees WHERE lower(username) = lower($1) LIMIT 1`,
      [username]
    );
    const emp = empR.rows?.[0] || {};

    healed.push({
      id: trackId,
      approvalId: String(approval.id || ''),
      applicantUsername: username,
      applicantName: String(emp.name || payload.applicantName || username).trim(),
      applicantRole: String(emp.role || '').trim(),
      store: String(payload.store || emp.store || '').trim(),
      department: String(payload.department || emp.department || '').trim(),
      currentLevel: String(payload.currentLevel || '').trim(),
      currentPosition: String(payload.currentPosition || emp.position || '').trim(),
      targetPosition: String(payload.targetPosition || payload.newPosition || '').trim(),
      targetLevel: String(payload.targetLevel || payload.newLevel || '').trim(),
      promotionType: String(payload.promotionType || '').trim(),
      promoTier: String(payload.promoTier || 'level_promotion').trim(),
      mentorUsername: String(payload.mentorUsername || '').trim(),
      mentorName: String(payload.mentorName || '').trim(),
      requiredTopicIds,
      trainingStartDate: String(payload.trainingStartDate || '').trim() || null,
      trainingDays: Number(payload.trainingDays || 3) || 3,
      trainingPeriods: Array.isArray(payload.trainingPeriods) ? payload.trainingPeriods : [],
      trainingDueDate: String(row.due_date || payload.trainingDueDate || '').trim() || null,
      assessmentStatus: 'pending',
      formalApplied: false,
      status: 'qualification_approved',
      healedAt: hrmsNowISO(),
      createdAt,
      updatedAt: hrmsNowISO(),
    });
    existingApprovalIds.add(String(approval.id || ''));
    existingIds.add(trackId);
  }
  return healed;
}

/**
 * @param {object} opts
 * @param {import('pg').Pool} opts.pool
 * @param {object} opts.state
 * @param {Function} opts.mergeSharedStateFields
 * @param {() => string} opts.hrmsNowISO
 * @returns {Promise<object[]>} 合并后的 tracks（含新治愈项）
 */
export async function healMissingPromotionTracks({
  pool,
  state,
  mergeSharedStateFields,
  hrmsNowISO,
}) {
  const existing = Array.isArray(state?.promotionTracks) ? state.promotionTracks : [];
  const healed = await buildOrphanPromotionTracks({ pool, existingTracks: existing, hrmsNowISO });
  if (!healed.length) return existing;
  if (typeof mergeSharedStateFields === 'function') {
    await mergeSharedStateFields({ promotionTracks: healed }, { promotionTracks: 'id' });
  }
  return [...healed, ...existing];
}
