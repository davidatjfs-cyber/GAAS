import {
  resolvePromotionApplicantContext,
  handleFormalPromotionApproved,
  handleQualificationPromotionApproved,
  handlePromotionRejected,
  notifyPromotionPendingAssignee,
} from '../promotion-after-decide-helpers.js';

export async function beforeUpdate(ctx) {
  const {
    res,
    row,
    role,
    username,
    nowIso,
    approved,
    mentorUsernameRaw,
    mentorNameRaw,
    trainingStartDateRaw,
    trainingDaysRaw,
    trainingPeriodsRaw,
    promotedSalaryRaw,
    updatedPayload,
    deps,
  } = ctx;
  if (String(row.type || '') !== 'promotion') return;

  const { pool, safeDateOnly, normalizePromotionTrainingPeriods } = deps;

  const stage = String(updatedPayload?.promotionStage || '').trim().toLowerCase();
  if (stage === 'qualification') {
    const currentRole = String(role || '').trim().toLowerCase();
    const isStoreManagerStep = currentRole === 'store_manager';
    if (approved && isStoreManagerStep && !mentorUsernameRaw) {
      res.status(400).json({ error: 'missing_mentor', message: '店长审批时必须指定带教人' });
      return { abort: true };
    }
    if (mentorUsernameRaw) {
      const mentorExists = await pool.query(
        `select 1 from users where lower(username) = lower($1)
         union all
         select 1 from employees where lower(username) = lower($1)
         limit 1`,
        [mentorUsernameRaw]
      );
      if (!mentorExists.rows?.length) {
        res.status(400).json({ error: 'mentor_not_found', message: '带教人账号不存在，请重新选择' });
        return { abort: true };
      }
      updatedPayload.mentorUsername = mentorUsernameRaw;
      if (mentorNameRaw) updatedPayload.mentorName = mentorNameRaw;
      updatedPayload.mentorAssignedBy = username;
      updatedPayload.mentorAssignedAt = nowIso;
    }
    const dt = safeDateOnly(trainingStartDateRaw);
    if (dt) updatedPayload.trainingStartDate = dt;
    if (Number.isFinite(trainingDaysRaw) && trainingDaysRaw > 0) {
      updatedPayload.trainingDays = Math.max(1, Math.min(30, Math.floor(trainingDaysRaw)));
    }
    const normalizedPeriods = normalizePromotionTrainingPeriods(trainingPeriodsRaw);
    if (normalizedPeriods.length) {
      updatedPayload.trainingPeriods = normalizedPeriods;
    }
  }

  if (stage === 'formal') {
    const currentRole = String(role || '').trim().toLowerCase();
    const isStoreManagerStep = currentRole === 'store_manager';
    if (approved && isStoreManagerStep) {
      const salaryVal = Number(promotedSalaryRaw);
      if (!Number.isFinite(salaryVal) || salaryVal <= 0) {
        res.status(400).json({ error: 'missing_promoted_salary', message: '店长审批正式晋升时必须填写晋升后薪资' });
        return { abort: true };
      }
      updatedPayload.promotedSalary = Number(salaryVal.toFixed(2));
      updatedPayload.promotedSalarySetBy = username;
      updatedPayload.promotedSalarySetAt = nowIso;
    }
  }
}

export async function afterDecide(ctx) {
  const { req, deps, updated, nextAssignee, note, username } = ctx;

  try {
    if (!updated || String(updated.type || '') !== 'promotion') return;

    const state0 = (await deps.getSharedState()) || {};
    const promoCtx = {
      ...resolvePromotionApplicantContext(state0, updated, deps),
      decidedBy: username,
    };
    let state = state0;

    if (promoCtx.finalApproved && promoCtx.stage === 'formal') {
      state = await handleFormalPromotionApproved({
        req,
        deps,
        updated,
        ctx: promoCtx,
        state0,
      });
    }

    if (promoCtx.finalApproved && promoCtx.stage === 'qualification') {
      state = await handleQualificationPromotionApproved({
        req,
        deps,
        updated,
        ctx: promoCtx,
        state0,
      });
    }

    if (promoCtx.finalRejected) {
      await handlePromotionRejected({ req, deps, updated, note, ctx: promoCtx });
    }

    if (String(updated.status || '') === 'pending' && nextAssignee) {
      await notifyPromotionPendingAssignee({ deps, updated, nextAssignee, ctx: promoCtx, state });
    }
  } catch (e) { /* ignore */ }
}
