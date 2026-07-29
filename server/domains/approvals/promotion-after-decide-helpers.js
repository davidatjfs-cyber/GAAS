/**
 * P4 peel: promotion afterDecide orchestration helpers.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'approvals', handler: 'promotion-after-decide' });

export function resolvePromotionApplicantContext(state0, updated, deps) {
  const { stateFindUserRecord } = deps;
  const applicantUser = String(updated.applicant_username || '').trim();
  const applicant = stateFindUserRecord(state0, applicantUser) || {};
  const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
  const applicantManager = String(applicant?.managerUsername || '').trim();
  const applicantStore = String(applicant?.store || updated.payload?.store || '').trim();
  const applicantRole = String(applicant?.role || '').trim();
  const applicantPosition = String(applicant?.position || updated.payload?.currentPosition || '').trim();
  const applicantDepartment = String(applicant?.department || updated.payload?.department || '').trim();
  const finalApproved = String(updated.status || '') === 'approved';
  const finalRejected = String(updated.status || '') === 'rejected';
  const stage = String(updated.payload?.promotionStage || 'qualification').trim().toLowerCase();
  return {
    applicantUser,
    applicant,
    applicantName,
    applicantManager,
    applicantStore,
    applicantRole,
    applicantPosition,
    applicantDepartment,
    finalApproved,
    finalRejected,
    stage,
  };
}

export function buildFormalPromotionEmployeeUpdate(state, ctx, updated, deps) {
  const { applicantUser, applicantName, applicantStore } = ctx;
  const { hrmsNowISO, findUserSalary, randomUUID } = deps;
  const formalPromoTier = String(updated.payload?.promoTier || 'level_promotion').trim();
  const isSkillBump = formalPromoTier === 'skill_bump';
  const newLevel = String(updated.payload?.newLevel || updated.payload?.level || '').trim();
  const newPosition = String(updated.payload?.newPosition || updated.payload?.position || '').trim();
  const promoReason = String(updated.payload?.reason || '').trim();
  const promotedSalary = Number(updated.payload?.promotedSalary);
  const hasPromotedSalary = Number.isFinite(promotedSalary) && promotedSalary > 0;
  const oldSalary = findUserSalary(state, applicantUser);

  const employees = Array.isArray(state.employees) ? state.employees : [];
  const empIdx = employees.findIndex((e) => String(e?.username || '').toLowerCase() === applicantUser.toLowerCase());
  let nextState = state;
  let oldLevel = '';
  let oldPosition = '';

  if (empIdx >= 0) {
    const nextEmployees = employees.slice();
    oldLevel = String(nextEmployees[empIdx].level || '').trim();
    oldPosition = String(nextEmployees[empIdx].position || '').trim();
    const promoRecord = {
      date: hrmsNowISO().slice(0, 10),
      fromLevel: oldLevel,
      toLevel: isSkillBump ? oldLevel : (newLevel || oldLevel),
      fromPosition: oldPosition,
      toPosition: isSkillBump ? oldPosition : (newPosition || oldPosition),
      promoTier: formalPromoTier,
      reason: promoReason,
      approvalId: String(updated.id || ''),
    };
    const history = Array.isArray(nextEmployees[empIdx].promotionHistory)
      ? nextEmployees[empIdx].promotionHistory.slice()
      : [];
    history.push(promoRecord);
    nextEmployees[empIdx] = {
      ...nextEmployees[empIdx],
      ...(isSkillBump
        ? {}
        : { level: newLevel || nextEmployees[empIdx].level, position: newPosition || nextEmployees[empIdx].position }),
      ...(hasPromotedSalary ? { salary: Number(promotedSalary.toFixed(2)) } : {}),
      promotionHistory: history,
    };
    nextState = { ...nextState, employees: nextEmployees };
  }

  let salaryChangeHistory = nextState.salaryChangeHistory;
  if (hasPromotedSalary) {
    const newSalary = Number(promotedSalary.toFixed(2));
    const oldSalaryNum = Number(oldSalary);
    const rec = {
      id: randomUUID(),
      approvalId: String(updated.id || ''),
      source: 'promotion_formal',
      targetUsername: applicantUser,
      targetName: applicantName,
      store: applicantStore,
      oldSalary: Number.isFinite(oldSalaryNum) ? Number(oldSalaryNum.toFixed(2)) : null,
      newSalary,
      delta: Number.isFinite(oldSalaryNum) ? Number((newSalary - oldSalaryNum).toFixed(2)) : null,
      approvedBy: ctx.decidedBy,
      approvedAt: hrmsNowISO(),
      reason: promoReason,
      chain: Array.isArray(updated.chain)
        ? updated.chain.map((s) => ({
            step: Number(s?.step || 0) || 0,
            assignee: String(s?.assignee || '').trim(),
            status: String(s?.status || '').trim(),
            decidedAt: String(s?.decidedAt || '').trim(),
          }))
        : [],
    };
    const historyRows = Array.isArray(nextState.salaryChangeHistory) ? nextState.salaryChangeHistory.slice() : [];
    historyRows.unshift(rec);
    salaryChangeHistory = historyRows;
    nextState = { ...nextState, salaryChangeHistory };
  }

  return {
    state: nextState,
    formalPromoTier,
    isSkillBump,
    newLevel,
    newPosition,
    hasPromotedSalary,
    promotedSalary,
    oldSalary,
  };
}

export async function applyFormalPromotionSalaryTimeline({
  req,
  deps,
  updated,
  ctx,
  promotedSalary,
  oldSalary,
  hasPromotedSalary,
}) {
  if (!hasPromotedSalary) return;
  const { applicantUser, applicant } = ctx;
  const { hrmsNowISO, safeDateOnly, insertSalaryTimeline, applyPromotionSalaryNextMonth } = deps;
  const decidedBy = ctx.decidedBy;
  try {
    const tidPromo = req.tenantId || req.user?.tenant_id || 'default';
    const oldSalaryNum = Number(oldSalary);
    if (Number.isFinite(oldSalaryNum) && oldSalaryNum > 0) {
      const joinD =
        safeDateOnly(applicant?.joinDate || applicant?.hireDate) || `${hrmsNowISO().slice(0, 7)}-01`;
      await insertSalaryTimeline({
        tenantId: tidPromo,
        username: applicantUser,
        amount: oldSalaryNum,
        effectiveFrom: joinD,
        source: 'profile_baseline',
        note: '晋升前底薪基线',
        createdBy: decidedBy,
      });
    }
    const newSalary = Number(promotedSalary.toFixed(2));
    await applyPromotionSalaryNextMonth({
      tenantId: tidPromo,
      username: applicantUser,
      newSalary,
      approvalId: updated.id,
      approvedAt: hrmsNowISO().slice(0, 10),
      createdBy: decidedBy,
    });
  } catch (tlErr) {
    log.error({ msg: 'promotion_salary_timeline_failed', err: tlErr?.message });
  }
}

export async function assignFormalPromotionTraining({ req, deps, updated, ctx, employeeUpdate }) {
  const { applicantUser, applicantManager } = ctx;
  const { createTrainingAssignment, getPromotionRequiredTopics, getPromotionTrackProgress } = deps;
  const { isSkillBump, newPosition } = employeeUpdate;
  const trackId = String(updated.payload?.promotionTrackId || '').trim();
  if (isSkillBump || !newPosition) return trackId;

  const newPosTopics = await getPromotionRequiredTopics(newPosition, employeeUpdate.newLevel);
  if (!newPosTopics.length) return trackId;

  const progress = await getPromotionTrackProgress(
    applicantUser,
    newPosTopics.map((t) => t.id)
  );
  const certifiedIds = new Set(progress.items.filter((i) => i.certified).map((i) => i.topicId));
  for (const topic of newPosTopics) {
    if (certifiedIds.has(topic.id)) continue;
    await createTrainingAssignment({
      employeeUsername: applicantUser,
      topicId: topic.id,
      assignedBy: applicantManager || ctx.decidedBy,
      note: `晋升至「${newPosition}」后的岗位培训`,
      requirePractice: true,
      source: 'promotion_formal',
      relatedTrackId: trackId || null,
      tenantId: req.tenantId || req.user?.tenant_id,
    });
  }
  return trackId;
}

export function markFormalPromotionTrackPromoted(state, trackId, deps) {
  const { hrmsNowISO } = deps;
  const tracks = Array.isArray(state.promotionTracks) ? state.promotionTracks.slice() : [];
  const trackIdx = tracks.findIndex((t) => String(t?.id || '').trim() === trackId);
  if (trackIdx >= 0) {
    tracks[trackIdx] = { ...tracks[trackIdx], status: 'promoted', updatedAt: hrmsNowISO() };
  }
  return { tracks, trackIdx };
}

export async function handleFormalPromotionApproved({ req, deps, updated, ctx, state0 }) {
  const { makeNotif, mergeSharedStateFields, uniqUsernames } = deps;
  const { applicantUser, applicantName, applicantManager } = ctx;

  const employeeUpdate = buildFormalPromotionEmployeeUpdate(state0, ctx, updated, deps);
  let state = employeeUpdate.state;

  await applyFormalPromotionSalaryTimeline({
    req,
    deps,
    updated,
    ctx,
    promotedSalary: employeeUpdate.promotedSalary,
    oldSalary: employeeUpdate.oldSalary,
    hasPromotedSalary: employeeUpdate.hasPromotedSalary,
  });

  const trackId = String(updated.payload?.promotionTrackId || '').trim();
  const { tracks, trackIdx } = markFormalPromotionTrackPromoted(state, trackId, deps);
  await assignFormalPromotionTraining({ req, deps, updated, ctx, employeeUpdate });

  const msg = `${applicantName}，恭喜，你的晋升已经审批通过。`;
  const recipients = uniqUsernames([applicantUser, applicantManager].filter(Boolean));
  const notifs = recipients.map((u) =>
    makeNotif(u, '晋升申请已通过', msg, { type: 'promotion_result', approvalId: updated.id })
  );

  await mergeSharedStateFields(
    {
      employees: state.employees,
      salaryChangeHistory: state.salaryChangeHistory,
      notifications: notifs,
      ...(trackIdx >= 0 ? { promotionTracks: tracks } : {}),
    },
    { employees: 'username', notifications: 'id', ...(trackIdx >= 0 ? { promotionTracks: 'id' } : {}) }
  );
  return trackIdx >= 0 ? { ...state, promotionTracks: tracks } : state;
}

export async function resolveQualificationRequiredTopics({ pool, deps, updated, ctx: _ctx }) {
  const { getPromotionRequiredTopics } = deps;
  const promoTier = String(updated.payload?.promoTier || 'level_promotion').trim();
  if (promoTier === 'skill_bump') {
    const selIds = Array.isArray(updated.payload?.selectedTopicIds)
      ? updated.payload.selectedTopicIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (!selIds.length) return [];
    const sr = await pool.query(
      'SELECT * FROM training_topics WHERE id = ANY($1::int[]) AND is_active = true ORDER BY sort_order, id',
      [selIds]
    );
    return sr.rows;
  }
  const targetPosition = String(updated.payload?.targetPosition || updated.payload?.newPosition || '').trim();
  const targetLevel = String(updated.payload?.targetLevel || updated.payload?.newLevel || '').trim();
  return getPromotionRequiredTopics(targetPosition, targetLevel);
}

export function computeQualificationTrainingDueDate(payload, deps) {
  const { safeDateOnly, normalizePromotionTrainingPeriods } = deps;
  const trainingStartDate =
    safeDateOnly(payload?.trainingStartDate) || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const trainingDays = Math.max(1, Math.min(30, Number(payload?.trainingDays || 3) || 3));
  const trainingPeriods = normalizePromotionTrainingPeriods(payload?.trainingPeriods);
  let trainingDueDate = trainingStartDate;
  if (trainingPeriods.length) {
    trainingDueDate = trainingPeriods[trainingPeriods.length - 1].endDate;
  } else {
    const dueTs = new Date(trainingStartDate + 'T00:00:00').getTime() + (trainingDays - 1) * 86400000;
    trainingDueDate = new Date(dueTs).toISOString().slice(0, 10);
  }
  return { trainingStartDate, trainingDays, trainingPeriods, trainingDueDate };
}

export function buildQualificationPromotionTrack({ updated, ctx, requiredTopics, trainingMeta, deps }) {
  const { applicantUser, applicantName, applicantRole, applicantStore, applicantDepartment, applicantPosition, applicant } =
    ctx;
  const { hrmsNowISO, randomUUID } = deps;
  const { trainingStartDate, trainingDays, trainingPeriods, trainingDueDate } = trainingMeta;
  const targetPosition = String(updated.payload?.targetPosition || updated.payload?.newPosition || '').trim();
  const targetLevel = String(updated.payload?.targetLevel || updated.payload?.newLevel || '').trim();
  const promoTier = String(updated.payload?.promoTier || 'level_promotion').trim();
  const mentorUsername = String(updated.payload?.mentorUsername || '').trim();
  const mentorName = String(updated.payload?.mentorName || '').trim();
  const trackId = randomUUID();
  return {
    trackId,
    track: {
      id: trackId,
      approvalId: String(updated.id || ''),
      applicantUsername: applicantUser,
      applicantName,
      applicantRole,
      store: applicantStore,
      department: applicantDepartment,
      currentLevel: String(updated.payload?.currentLevel || applicant?.level || '').trim(),
      currentPosition: String(updated.payload?.currentPosition || applicantPosition || '').trim(),
      targetPosition,
      targetLevel,
      promotionType: String(updated.payload?.promotionType || '').trim(),
      promoTier,
      mentorUsername,
      mentorName,
      requiredTopicIds: requiredTopics.map((t) => t.id),
      trainingStartDate,
      trainingDays,
      trainingPeriods,
      trainingDueDate,
      assessmentStatus: 'pending',
      formalApplied: false,
      status: 'qualification_approved',
      createdAt: hrmsNowISO(),
      updatedAt: hrmsNowISO(),
    },
    targetPosition,
    mentorUsername,
    mentorName,
    trainingDueDate,
  };
}

export async function handleQualificationPromotionApproved({ req, deps, updated, ctx, state0 }) {
  const {
    makeNotif,
    appendNotifications,
    mergeSharedStateFields,
    uniqUsernames,
    createTrainingAssignment,
    isKitchenByRoleOrPosition,
    pickHqManagerUsername,
    pickStoreRoleUsernameByStore,
  } = deps;
  const { applicantUser, applicantName, applicantRole, applicantPosition, applicantDepartment, applicantStore } = ctx;

  const requiredTopics = await resolveQualificationRequiredTopics({ pool: deps.pool, deps, updated, ctx });
  const trainingMeta = computeQualificationTrainingDueDate(updated.payload, deps);
  const trackBuild = buildQualificationPromotionTrack({
    updated,
    ctx,
    requiredTopics,
    trainingMeta,
    deps,
  });

  const tracks = Array.isArray(state0.promotionTracks) ? state0.promotionTracks.slice() : [];
  tracks.unshift(trackBuild.track);

  const isKitchen = isKitchenByRoleOrPosition(applicantRole, applicantPosition, applicantDepartment);
  const productionManagerByStore = pickStoreRoleUsernameByStore(state0, applicantStore, ['store_production_manager']);
  const storeManagerByStore = pickStoreRoleUsernameByStore(state0, applicantStore, ['store_manager']);
  const assignmentReviewer = trackBuild.mentorUsername || productionManagerByStore || storeManagerByStore || ctx.decidedBy;

  for (const topic of requiredTopics) {
    await createTrainingAssignment({
      employeeUsername: applicantUser,
      topicId: topic.id,
      assignedBy: assignmentReviewer,
      dueDate: trackBuild.trainingDueDate,
      note: `晋升至「${trackBuild.targetPosition}」的能力要求培训`,
      requirePractice: true,
      source: 'promotion_qualification',
      relatedTrackId: trackBuild.trackId,
      tenantId: req.tenantId || req.user?.tenant_id,
    });
  }

  const hqManager = await pickHqManagerUsername(state0);
  const mentorDisplay = trackBuild.mentorName || trackBuild.mentorUsername || '待指定带教人';

  const title = '晋升资格申请已批准';
  const msg = `${applicantName}的晋升资格申请已批准，指定带教人：${mentorDisplay}。请积极投入培训与考核，争取早日晋升成功！`;
  const recipients = uniqUsernames(
    [applicantUser, trackBuild.mentorUsername, storeManagerByStore, hqManager, isKitchen ? productionManagerByStore : ''].filter(
      Boolean
    )
  );
  const notifications = recipients.map((u) =>
    makeNotif(u, title, msg, { type: 'promotion_qualification_approved', approvalId: updated.id })
  );
  if (requiredTopics.length) {
    const planMsg = `系统已根据培训知识库为${applicantName}生成晋升能力培训任务：${requiredTopics.map((t) => t.title).join('、')}，截止日期：${trackBuild.trainingDueDate}。`;
    notifications.push(
      ...recipients.map((u) =>
        makeNotif(u, '晋升培训任务已生成', planMsg, { type: 'promotion_training_plan', approvalId: updated.id })
      )
    );
  }
  await appendNotifications(notifications);
  await mergeSharedStateFields({ promotionTracks: tracks }, { promotionTracks: 'id' });
  return { ...state0, promotionTracks: tracks };
}

export async function handlePromotionRejected({ req: _req, deps, updated, note, ctx }) {
  const { makeNotif, appendNotifications, mergeSharedStateFields, getSharedState, hrmsNowISO, uniqUsernames } = deps;
  const { applicantUser, applicantName, applicantManager, stage } = ctx;

  const stageLabel = stage === 'formal' ? '正式晋升' : '晋升资格';
  const msg = `${applicantName}，你的${stageLabel}申请因为${note || '相关原因'}没有审批通过。`;
  const recipients = uniqUsernames([applicantUser, applicantManager].filter(Boolean));
  await appendNotifications(
    recipients.map((u) => makeNotif(u, '晋升申请未通过', msg, { type: 'promotion_result', approvalId: updated.id }))
  );

  if (stage !== 'formal') return;
  const formalTrackId = String(updated.payload?.promotionTrackId || '').trim();
  if (!formalTrackId) return;
  try {
    const stF = (await getSharedState()) || {};
    const tracksF = Array.isArray(stF.promotionTracks) ? stF.promotionTracks.slice() : [];
    const tIdx = tracksF.findIndex((t) => String(t?.id || '').trim() === formalTrackId);
    if (tIdx >= 0) {
      tracksF[tIdx] = { ...tracksF[tIdx], status: 'formal_rejected', formalApplied: false, updatedAt: hrmsNowISO() };
      await mergeSharedStateFields({ promotionTracks: tracksF }, { promotionTracks: 'id' });
    }
  } catch (p3e) {
    log.warn({ msg: 'promotion_track_update_failed', err: p3e?.message });
  }
}

export async function notifyPromotionPendingAssignee({ deps, updated, nextAssignee, ctx, state }) {
  const { makeNotif, appendNotifications, stateFindUserRecord } = deps;
  const { applicantName, stage } = ctx;
  const stageLabel = stage === 'formal' ? '正式晋升申请' : '晋升资格申请';
  const nextAssigneeRec = stateFindUserRecord(state, nextAssignee) || {};
  const nextRole = String(nextAssigneeRec?.role || '').trim();
  const needAssignMentorTip =
    stage === 'qualification' && nextRole === 'store_manager'
      ? '（通过时请指定带教人并确认培训起始日期）'
      : '';
  const msg = `${applicantName} 提交了${stageLabel}，需要您审批${needAssignMentorTip}。`;
  await appendNotifications([
    makeNotif(nextAssignee, '晋升申请待审批', msg, { type: 'promotion_request', approvalId: updated.id }),
  ]);
}
