/**
 * POST /api/approvals 创建审批纯逻辑。
 * 不接触 req/res；鉴权门留在 routes-lifecycle.js。
 */
import {
  buildConfiguredApprovalAssignees,
  resolveStoreApprovalRoleUsername,
} from '../../approval-assignee-resolution.js';
import { getPromotionTrackProgress, getCrossTrackTechnicianStatus } from '../../training.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import {
  validateLeaveCreate,
  validateOnboardingCreate,
  validatePaymentFieldsSync,
  validatePointsPayloadSync,
  validatePromotionStageSync,
  validateRewardPunishmentSync,
} from './create-validators.js';

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
          console.warn('[approvals] payment duplicate check failed:', dupErr?.message);
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
    const applicantRole = String(applicant?.role || role || '').trim().toLowerCase();
    const applicantStoreLower = String(applicant?.store || '').trim().toLowerCase();
    const isHeadquarterApplicant =
      applicantRole === 'admin'
      || applicantRole === 'hq_manager'
      || applicantRole === 'hr_manager'
      || applicantRole === 'cashier'
      || applicantRole.startsWith('custom_')
      || (applicantStoreLower.includes('总部') || applicantStoreLower.includes('headquarter') || applicantStoreLower.includes('hq'));

    if (type === 'payment') {
      const configured = await buildConfiguredApprovalAssignees(state, type, ctx, resolveDutyApproverForStore);
      if (configured.length) {
        assignees = configured;
      } else {
        const store = String(payload?.store || '').trim();
        const flow = getPaymentFlowForStore(state, store);
        if (flow.approvers.length) {
          assignees = flow.approvers;
        } else {
          assignees = [applicantManager, cashierUsername, adminUsername].filter(Boolean);
        }
      }
    } else if (type === 'leave') {
      assignees = isHeadquarterApplicant
        ? [applicantManager, hrManagerUsername].filter(Boolean)
        : [applicantManager, hqManagerUsername, hrManagerUsername].filter(Boolean);
    } else if (type === 'promotion') {
      const stage = String(payload?.promotionStage || 'qualification').trim().toLowerCase();
      if (stage === 'qualification') {
        const applicantPosition = String(applicant?.position || payload?.currentPosition || '').trim();
        const applicantDepartment = String(applicant?.department || payload?.department || '').trim();
        const kitchenApplicant = isKitchenByRoleOrPosition(applicantRole, applicantPosition, applicantDepartment);
        const applicantStoreName = String(applicant?.store || payload?.store || '').trim();
        const storeManagerByStore = await resolveStoreApprovalRoleUsername(
          state,
          applicantStoreName,
          ['store_manager'],
          resolveDutyApproverForStore
        );
        const productionManagerByStore = pickStoreRoleUsernameByStore(state, applicantStoreName, ['store_production_manager']);
        if (kitchenApplicant) {
          assignees = [productionManagerByStore, storeManagerByStore].filter(Boolean);
        } else {
          assignees = [storeManagerByStore].filter(Boolean);
        }
      } else {
        const applicantStoreName = String(applicant?.store || payload?.store || '').trim();
        const storeManagerByStore = await resolveStoreApprovalRoleUsername(
          state,
          applicantStoreName,
          ['store_manager'],
          resolveDutyApproverForStore
        );
        assignees = [storeManagerByStore, hqManagerUsername, hrManagerUsername].filter(Boolean);
      }
    } else {
      const configured = await buildConfiguredApprovalAssignees(state, type, ctx, resolveDutyApproverForStore);
      if (configured.length) {
        assignees = configured;
      } else {
        if (type === 'onboarding') {
          assignees = [applicantManager, hrManagerUsername, adminUsername].filter(Boolean);
        } else if (type === 'offboarding') {
          assignees = [applicantManager, hqManagerUsername, hrManagerUsername].filter(Boolean);
        } else if (type === 'reward_punishment') {
          assignees = [applicantManager, hrManagerUsername].filter(Boolean);
        } else if (type === 'points') {
          const storeManagerForPoints = await resolveStoreApprovalRoleUsername(
            state,
            applicantStore,
            ['store_manager'],
            resolveDutyApproverForStore
          );
          assignees = [storeManagerForPoints, hqManagerUsername, hrManagerUsername].filter(Boolean);
        } else {
          assignees = [applicantManager, adminUsername].filter(Boolean);
        }
      }
    }

    const seen = new Set();
    const uniq = [];
    (assignees || []).forEach(a => {
      const k = String(a || '').trim().toLowerCase();
      if (!k || seen.has(k)) return;
      seen.add(k);
      uniq.push(String(a || '').trim());
    });
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

        let msg = `${applicantName} 提交了${label}申请，请审批。`;
        if (type === 'offboarding') {
          const resignDate = safeDateOnly(payload?.resignDate || payload?.date || payload?.resignationDate);
          if (resignDate) msg = `${applicantName} 提交了离职申请，期望离职日期：${resignDate}`;
        }
        if (type === 'leave') {
          const startDate = safeDateOnly(payload?.startDate || payload?.fromDate || payload?.beginDate);
          const endDate = safeDateOnly(payload?.endDate || payload?.toDate || payload?.finishDate);
          if (startDate && endDate) msg = `${applicantName} 提交了休假申请：${startDate} 至 ${endDate}`;
        }
        if (type === 'onboarding') {
          const emp = payload?.employee && typeof payload.employee === 'object' ? payload.employee : {};
          const empName = String(emp?.name || '').trim() || '新员工';
          msg = `${applicantName} 提交了新员工「${empName}」的入职申请，请审批。`;
        }
        if (type === 'promotion') {
          const newLevel = String(payload?.newLevel || payload?.level || '').trim();
          msg = `${applicantName} 提交了晋升申请${newLevel ? `（目标级别：${newLevel}）` : ''}，请审批。`;
        }
        if (type === 'reward_punishment') {
          const targetUser = String(payload?.targetUsername || payload?.employeeUsername || '').trim();
          const targetRec = targetUser ? (stateFindUserRecord(state, targetUser) || {}) : {};
          const targetName = String(targetRec?.name || targetUser).trim() || applicantName;
          const rpType = String(payload?.rpType || payload?.category || '').trim();
          msg = `${applicantName} 提交了${rpType || '奖惩'}申请（${targetName}），请审批。`;
        }
        if (type === 'points') {
          const itemName = String(payload?.itemName || '积分事项').trim();
          const points = safeNumber(payload?.points) || 0;
          msg = `${applicantName} 提交了积分申请（${itemName}，${points}分），请审批。`;
        }

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
            console.error('[approval] feishu notify error:', feishuErr?.message);
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
          console.log('[recurring-reward] saved monthly template for applicant', username);
        } catch (re) {
          console.error('[recurring-reward] save template failed:', re?.message || re);
        }
      }
    }

    return { ok: true, item, label: approvalTypeLabel(type) };
  } catch (e) {
    return { error: 'server_error', status: 500, message: 'internal_error' };
  }
}
