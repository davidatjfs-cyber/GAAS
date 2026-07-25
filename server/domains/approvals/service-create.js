/**
 * POST /api/approvals 创建审批纯逻辑。
 * 不接触 req/res；鉴权门留在 routes-lifecycle.js。
 */
import { getPromotionTrackProgress, getCrossTrackTechnicianStatus } from '../../training.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import {
  resolveCreateAssignees,
  uniqAssignees,
} from './create-assignees.js';
import {
  validateLeaveCreate,
  validateOnboardingCreate,
  validatePaymentFieldsSync,
  validatePointsPayloadSync,
  validatePromotionStageSync,
  validateRewardPunishmentSync,
} from './create-validators.js';
import { buildCreateApprovalNotifyMessage } from './create-notify-message.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'approvals', handler: 'create' });

/**
 * @param {object} params
 * @returns {Promise<{ error: string, status: number, message?: string, id?: string } | { ok: true, item: object, label: string }>}
 */
export async function createApproval({
  pool,
  getSharedState,
  saveSharedState,
  stateFindUserRecord,
  stateOrDbFindUserRecord,
  pickAdminUsername,
  pickHqManagerUsername,
  pickCashierUsername,
  pickHrManagerUsername,
  approvalTypeLabel,
  safeDateOnly,
  safeNumber,
  uniqUsernames,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  getPaymentFlowForStore,
  pickStoreRoleUsernameByStore,
  isKitchenByRoleOrPosition,
  resolveDutyApproverForStore,
  appendNotifications,
  makeNotif,
  hrmsNowISO,
  username,
  role,
  type,
  payload,
  recurringFrequencyReward,
  tenantId,
  allowedStores,
}) {
  try {
    if (type === 'onboarding') {
      const empUser = String((payload?.employee?.username) || '').trim().toLowerCase();
      if (empUser) {
        const existing = await pool.query(
          `select id from approval_requests where type = 'onboarding' and status = 'pending' and lower(payload->'employee'->>'username') = $1 and tenant_id = $2 limit 1`,
          [empUser, tenantId]
        );
        if ((existing.rows || []).length) {
          return { error: 'duplicate_pending', status: 409, id: existing.rows[0].id };
        }
      }
    } else if (type !== 'payment' && type !== 'points' && type !== 'reward_punishment') {
      const existing = await pool.query(
        'select id from approval_requests where lower(applicant_username) = lower($1) and type = $2 and status = $3 and tenant_id = $4 limit 1',
        [username, type, 'pending', tenantId]
      );
      if ((existing.rows || []).length) {
        return { error: 'duplicate_pending', status: 409, id: existing.rows[0].id };
      }
    }

    let state = (await getSharedState()) || {};
    const applicant = stateFindUserRecord(state, username) || {};
    const applicantManager = String(applicant?.managerUsername || '').trim();
    const adminUsername = await pickAdminUsername(state);
    const hqManagerUsername = await pickHqManagerUsername(state);
    const cashierUsername = await pickCashierUsername(state);
    const hrManagerUsername = await pickHrManagerUsername(state);

    let assignees = [];

    // validations (independent of configured flow)
    if (type === 'onboarding') {
      const onbErr = validateOnboardingCreate({
        role,
        applicantManager,
        payload,
        state,
        stateFindUserRecord,
        safeDateOnly,
      });
      if (onbErr) return onbErr;
    } else if (type === 'offboarding') {
      if (!applicantManager) {
        return { error: 'missing_manager', status: 400 };
      }
      const applicantFull = (await stateOrDbFindUserRecord(state, username)) || applicant || {};
      const appStore = String(payload.store || applicantFull.store || '').trim();
      if (appStore) payload.store = appStore;
      payload.applicantName = String(applicantFull.name || payload.name || payload.applicantName || '').trim() || username;
      payload.applicantPosition = String(applicantFull.position || payload.applicantPosition || payload.position || '').trim() || '';
      payload.applicantDepartment = String(applicantFull.department || payload.applicantDepartment || '').trim() || '';
      payload.applicantLevel = String(applicantFull.level || payload.applicantLevel || '').trim() || '';
      const join0 = safeDateOnly(
        applicantFull.joinDate || applicantFull.hireDate || applicantFull.startDate
        || payload.applicantJoinDate || payload.joinDate || payload.hireDate || payload.entryDate
      );
      if (join0) payload.applicantJoinDate = join0;
    } else if (type === 'leave') {
      const leaveErr = validateLeaveCreate({ applicantManager, payload, safeDateOnly });
      if (leaveErr) return leaveErr;
    } else if (type === 'promotion') {
      const stageSync = validatePromotionStageSync({ applicantManager, payload });
      if (stageSync.error) return stageSync;
      const stage = stageSync.stage;
      if (stage === 'formal') {
        const trackId = String(payload?.promotionTrackId || '').trim();
        const tracks = Array.isArray(state?.promotionTracks) ? state.promotionTracks : [];
        const track = tracks.find(t => String(t?.id || '').trim() === trackId && String(t?.applicantUsername || '').trim().toLowerCase() === username.toLowerCase());
        if (!track) return { error: 'invalid_promotion_track', status: 400 };
        if (Array.isArray(track?.requiredTopicIds)) {
          const progress = await getPromotionTrackProgress(track.applicantUsername, track.requiredTopicIds);
          if (!progress.passed) return { error: 'track_not_passed', status: 400 };
        } else if (String(track?.assessmentStatus || '').trim() !== 'passed') {
          return { error: 'track_not_passed', status: 400 };
        }
      } else if (stage === 'qualification') {
        const targetPosition = String(payload?.targetPosition || payload?.newPosition || '').trim();
        const targetLevel = String(payload?.targetLevel || payload?.newLevel || '').trim();
        if (targetPosition === '出品经理' && targetLevel === '储备') {
          const crossTrack = await getCrossTrackTechnicianStatus(username);
          if (!crossTrack.eligible) {
            return { error: 'cross_track_prerequisite_not_met', status: 400 };
          }
        }
      }
    } else {
      if (type === 'payment') {
        const paySync = validatePaymentFieldsSync({
          role,
          payload,
          applicant,
          allowedStores,
          safeDateOnly,
          safeNumber,
        });
        if (paySync.error) return paySync;
        const { store, date, amount, category } = paySync;
        try {
          const dupPay = await pool.query(
            `SELECT id FROM approval_requests
             WHERE type = 'payment' AND status = 'pending'
               AND lower(applicant_username) = lower($1)
               AND trim(both from coalesce(payload->>'store','')) = trim(both from $2::text)
               AND left(trim(both from coalesce(payload->>'date', payload->>'applyDate', payload->>'requestDate','')), 10) = $3::text
               AND (nullif(replace(trim(both from coalesce(payload->>'amount','')), ',', ''), '')::numeric) = $4::numeric
               AND trim(both from coalesce(payload->>'category', payload->>'project','')) = trim(both from $5::text)
               AND tenant_id = $6
             LIMIT 1`,
            [username, store, date, amount, category, tenantId]
          );
          if ((dupPay.rows || []).length) {
            return { error: 'duplicate_pending', status: 409, id: dupPay.rows[0].id };
          }
        } catch (dupErr) {
          log.warn({ msg: 'approval_payment_duplicate_check_failed', err: dupErr?.message || String(dupErr) });
        }
      } else if (type === 'reward_punishment') {
        const rpErr = validateRewardPunishmentSync({
          role,
          payload,
          recurringFrequencyReward,
          state,
          stateFindUserRecord,
          safeNumber,
        });
        if (rpErr) return rpErr;
      } else if (type === 'points') {
        try {
          const dupCheck = await pool.query(
            `SELECT id FROM approval_requests
             WHERE type='points'
               AND lower(applicant_username)=lower($1)
               AND created_at >= CURRENT_DATE
               AND status != 'returned'
               AND (payload->>'resubmittedAt') IS NULL
               AND tenant_id = $2
             LIMIT 1`,
            [username, tenantId]
          );
          if (dupCheck.rows?.length > 0) {
            return { error: 'daily_limit', status: 400, message: '每天只能提交1次积分申请，今天已提交过' };
          }
        } catch (e) { /* ignore check error, allow submission */ }

        const ptsErr = validatePointsPayloadSync({
          role,
          applicantManager,
          applicant,
          username,
          payload,
          state,
          safeNumber,
        });
        if (ptsErr) return ptsErr;
      } else if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager' || role === 'cashier')) {
        return { error: 'forbidden', status: 403 };
      }
      if (!adminUsername) return { error: 'missing_admin', status: 500 };
    }

    const applicantStore = String(applicant?.store || payload?.store || '').trim();
    const ctx = {
      state,
      applicantUsername: username,
      applicantStore,
      managerUsername: applicantManager,
      adminUsername,
      hqManagerUsername,
      hrManagerUsername,
      cashierUsername
    };

    assignees = await resolveCreateAssignees({
      type,
      payload,
      state,
      ctx,
      applicant,
      role,
      applicantManager,
      adminUsername,
      hqManagerUsername,
      hrManagerUsername,
      cashierUsername,
      applicantStore,
      getPaymentFlowForStore,
      pickStoreRoleUsernameByStore,
      isKitchenByRoleOrPosition,
      resolveDutyApproverForStore,
    });

    const uniq = uniqAssignees(assignees);
    if (!uniq.length) return { error: 'missing_assignee', status: 400 };

    const chain = uniq.map((a, idx) => ({
      step: idx + 1,
      assignee: a,
      status: idx === 0 ? 'pending' : 'queued',
      decidedAt: null,
      note: ''
    }));

    const currentAssignee = chain[0]?.assignee || null;

    const r = await pool.query(
      `insert into approval_requests (type, status, applicant_username, current_assignee_username, chain, payload, tenant_id, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7, now(), now())
       returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
      [type, 'pending', username, currentAssignee, JSON.stringify(chain), JSON.stringify(payload), tenantId]
    );
    const item = r.rows?.[0] || null;

    try {
      if (item && type === 'promotion') {
        const stage = String(payload?.promotionStage || '').trim().toLowerCase();
        const trackId = String(payload?.promotionTrackId || '').trim();
        if (stage === 'formal' && trackId) {
          const tracks = Array.isArray(state?.promotionTracks) ? state.promotionTracks.slice() : [];
          const idxTrack = tracks.findIndex(t => String(t?.id || '').trim() === trackId);
          if (idxTrack >= 0) {
            tracks[idxTrack] = {
              ...tracks[idxTrack],
              formalApplied: true,
              formalApprovalId: String(item?.id || ''),
              updatedAt: hrmsNowISO()
            };
            state = { ...state, promotionTracks: tracks };
            await saveSharedState(state);
          }
        }
      }
    } catch (e) { /* ignore */ }

    try {
      if (item) {
        const label = approvalTypeLabel(type);
        const title = `${label}申请待审批`;
        const applicantName = String(applicant?.name || username).trim() || username;
        const msg = buildCreateApprovalNotifyMessage({
          type,
          label,
          applicantName,
          payload,
          state,
          stateFindUserRecord,
          safeDateOnly,
          safeNumber,
        });

        const recipients = uniqUsernames([currentAssignee]);
        const notifs = recipients.map((u) =>
          makeNotif(u, title, msg, { type: `${type}_request`, approvalId: item.id })
        );
        await appendNotifications(notifs);

        (async () => {
          try {
            if (currentAssignee) {
              const fu = await lookupFeishuUserByUsername(currentAssignee);
              if (fu?.open_id) {
                const feishuMsg = `📋 【HRMS 待审批提醒】\n\n${msg}\n\n请登录 HRMS 系统处理：https://nnyx.cc`;
                await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
              }
            }
          } catch (feishuErr) {
            log.error({ msg: 'approval_create_feishu_notify_failed', err: feishuErr?.message || String(feishuErr) });
          }
        })();
      }
    } catch (e) { /* ignore */ }

    if (type === 'reward_punishment' && recurringFrequencyReward === 'monthly' && item?.id) {
      const rpT = String(payload?.rpType || '').trim();
      if (rpT === '奖励' || rpT === 'reward') {
        try {
          const ymSh = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
          const snap = JSON.parse(JSON.stringify(payload));
          await pool.query(
            `insert into recurring_reward_templates (active, created_by, frequency, payload, last_generated_ym, updated_at, tenant_id)
             values (true, $1, 'monthly', $2::jsonb, $3, now(), $4)`,
            [username, JSON.stringify(snap), ymSh, resolveTenantIdDefault()]
          );
          log.info({ msg: 'recurring_reward_template_saved', username });
        } catch (re) {
          log.error({ msg: 'recurring_reward_save_template_failed', err: re?.message || String(re) });
        }
      }
    }

    return { ok: true, item, label: approvalTypeLabel(type) };
  } catch (e) {
    return { error: 'server_error', status: 500, message: 'internal_error' };
  }
}
