/**
 * POST /api/approvals/:id/decide — 审批决定（同意/拒绝）。
 * 从 index.js 拆出（P0-A1）；类型业务在 handlers/，依赖经 deps 注入。
 */
import { canAccessApprovalCenter } from '../../store-duty-bindings.js';
import * as onboardingHandler from './handlers/onboarding.js';
import * as leaveHandler from './handlers/leave.js';
import * as offboardingHandler from './handlers/offboarding.js';
import * as promotionHandler from './handlers/promotion.js';
import * as rewardPunishmentHandler from './handlers/reward-punishment.js';
import * as pointsHandler from './handlers/points.js';
import * as monthlyConfirmHandler from './handlers/monthly-confirm.js';

const BEFORE_UPDATE_BY_TYPE = {
  leave: leaveHandler,
  promotion: promotionHandler,
  offboarding: offboardingHandler,
};

const AFTER_DECIDE_BY_TYPE = {
  onboarding: onboardingHandler,
  leave: leaveHandler,
  offboarding: offboardingHandler,
  promotion: promotionHandler,
  reward_punishment: rewardPunishmentHandler,
  points: pointsHandler,
  monthly_confirm: monthlyConfirmHandler,
};

async function runBeforeUpdatePreChain(ctx) {
  const mod = BEFORE_UPDATE_BY_TYPE[String(ctx.row.type || '')];
  if (!mod) return;
  ctx.beforeChain = true;
  const result = await mod.beforeUpdate(ctx);
  if (result?.abort) return result;
}

async function runBeforeUpdatePostChain(ctx) {
  if (String(ctx.row.type || '') !== 'offboarding') return;
  ctx.beforeChain = false;
  await offboardingHandler.beforeUpdate(ctx);
}

async function runAfterDecide(ctx) {
  const mod = AFTER_DECIDE_BY_TYPE[String(ctx.updated?.type || '')];
  if (mod) await mod.afterDecide(ctx);
}

export async function handleApprovalDecide(req, res, deps) {
  const {
    pool,
    hrmsNowISO,
    getSharedState,
    stateFindUserRecord,
    safeErrMessage,
    approvalTypeLabel,
    lookupFeishuUserByUsername,
    sendLarkMessage,
  } = deps;

  if (!canAccessApprovalCenter(req.user?.role, { dutyRows: [], currentStore: req.user?.current_store, primaryStore: req.user?.primary_store })) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const __decideStartedAt = Date.now();
  const username = String(req.user?.username || '').trim();
  const role = String(req.user?.role || '').trim();
  const id = String(req.params?.id || '').trim();
  const approved = !!req.body?.approved;
  const note = String(req.body?.note || '').trim();
  const departureType = String(req.body?.departureType || '').trim();
  const remainingLeaveDaysRaw = req.body?.remainingLeaveDays;
  const mentorUsernameRaw = String(req.body?.mentorUsername || '').trim();
  const mentorNameRaw = String(req.body?.mentorName || '').trim();
  const trainingStartDateRaw = String(req.body?.trainingStartDate || '').trim();
  const trainingDaysRaw = Number(req.body?.trainingDays || 0);
  const trainingPeriodsRaw = Array.isArray(req.body?.trainingPeriods) ? req.body.trainingPeriods : [];
  const promotedSalaryRaw = req.body?.promotedSalary;
  if (!username) return res.status(400).json({ error: 'missing_user' });
  if (!id) return res.status(400).json({ error: 'missing_id' });

  let decideExtras = {};

  try {
    const r0 = await pool.query(
      'select id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at from approval_requests where id = $1 limit 1',
      [id]
    );
    const row = r0.rows?.[0] || null;
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (String(row.status || '') !== 'pending') return res.status(400).json({ error: 'not_pending' });
    const chain = Array.isArray(row.chain) ? row.chain : [];
    const idx = chain.findIndex(x => String(x?.assignee || '').toLowerCase() === username.toLowerCase() && String(x?.status || '') === 'pending');
    if (idx < 0) return res.status(403).json({ error: 'forbidden' });

    const nowIso = hrmsNowISO();
    chain[idx] = { ...chain[idx], status: approved ? 'approved' : 'rejected', decidedAt: nowIso, note };

    let nextStatus = approved ? 'pending' : 'rejected';
    let nextAssignee = null;
    let effectiveDate = row.effective_date;
    let updatedPayload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : {};

    const ctxBase = {
      req,
      res,
      deps,
      row,
      chain,
      updatedPayload,
      effectiveDate,
      nextStatus,
      nextAssignee,
      approved,
      note,
      username,
      role,
      nowIso,
      decideExtras,
      departureType,
      remainingLeaveDaysRaw,
      mentorUsernameRaw,
      mentorNameRaw,
      trainingStartDateRaw,
      trainingDaysRaw,
      trainingPeriodsRaw,
      promotedSalaryRaw,
    };
    Object.defineProperty(ctxBase, 'effectiveDate', {
      get() { return effectiveDate; },
      set(v) { effectiveDate = v; },
    });

    const preResult = await runBeforeUpdatePreChain(ctxBase);
    if (preResult?.abort) return;

    if (approved) {
      const next = chain.slice(idx + 1).find(x => String(x?.status || '') === 'queued');
      if (next) {
        nextAssignee = String(next.assignee || '').trim() || null;
        const nextIdx = chain.findIndex(x => String(x?.assignee || '') === String(next.assignee || '') && String(x?.status || '') === 'queued');
        if (nextIdx >= 0) chain[nextIdx] = { ...chain[nextIdx], status: 'pending' };
      } else {
        nextStatus = 'approved';
        nextAssignee = null;
      }
    }
    ctxBase.nextStatus = nextStatus;
    ctxBase.nextAssignee = nextAssignee;

    await runBeforeUpdatePostChain(ctxBase);

    const r1 = await pool.query(
      `update approval_requests
       set status=$2, current_assignee_username=$3, chain=$4::jsonb, effective_date=$5, payload=$6::jsonb, updated_at=now()
       where id=$1
       returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
      [id, nextStatus, nextAssignee, JSON.stringify(chain), effectiveDate || null, JSON.stringify(updatedPayload)]
    );
    const updated = r1.rows?.[0] || null;

    await runAfterDecide({ ...ctxBase, updated, nextStatus, nextAssignee });

    try {
      if (updated) {
        const feishuState = (await getSharedState()) || {};
        const feishuApplicant = stateFindUserRecord(feishuState, updated.applicant_username) || {};
        const feishuApplicantName = String(feishuApplicant?.name || updated.applicant_username).trim() || updated.applicant_username;
        const feishuLabel = approvalTypeLabel(String(updated.type || ''));

        if (String(updated.status || '') === 'pending' && nextAssignee) {
          (async () => {
            try {
              const fu = await lookupFeishuUserByUsername(nextAssignee);
              if (fu?.open_id) {
                const feishuMsg = `📋 【HRMS 待审批提醒】\n\n${feishuApplicantName} 提交了${feishuLabel}申请，需要您审批。\n\n请登录 HRMS 系统处理：https://nnyx.cc`;
                await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
              }
            } catch (e) { console.error('[approval-decide] feishu notify next error:', e?.message); }
          })();
        }

        if (String(updated.status || '') === 'approved' || String(updated.status || '') === 'rejected') {
          const resultText = String(updated.status || '') === 'approved' ? '已通过' : '被拒绝';
          (async () => {
            try {
              const fu = await lookupFeishuUserByUsername(updated.applicant_username);
              if (fu?.open_id) {
                const feishuMsg = `📋 【HRMS 审批结果】\n\n${feishuApplicantName}，您的${feishuLabel}申请${resultText}。${note ? `\n原因：${note}` : ''}\n\n请登录 HRMS 查看详情：https://nnyx.cc`;
                await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
              }
            } catch (e) { console.error('[approval-decide] feishu notify applicant error:', e?.message); }
          })();
        }
      }
    } catch (e) { /* ignore */ }

    const __decideMs = Date.now() - __decideStartedAt;
    console.log('[approval-decide] ok', { id, ms: __decideMs, status: updated?.status, type: updated?.type });
    return res.json(Object.keys(decideExtras).length ? { item: updated, decideMs: __decideMs, ...decideExtras } : { item: updated, decideMs: __decideMs });
  } catch (e) {
    console.log('[approval-decide] error', { id, ms: Date.now() - __decideStartedAt, err: safeErrMessage(e) });
    return res.status(500).json({ error: 'server_error', message: 'internal_error' });
  }
}
