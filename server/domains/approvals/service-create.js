/**
 * POST /api/approvals 创建审批纯逻辑。
 * 不接触 req/res；鉴权门留在 routes-lifecycle.js。
 */
import { resolveCreateAssignees, uniqAssignees } from './create-assignees.js';
import {
  checkDuplicatePendingApproval,
  validateCreateApprovalByType,
  buildApprovalChain,
  insertPendingApprovalRequest,
  syncFormalPromotionTrackOnCreate,
  notifyApprovalCreated,
  saveMonthlyRecurringRewardTemplateIfNeeded,
} from './create-approval-helpers.js';
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
    const dupErr = await checkDuplicatePendingApproval({ pool, type, username, payload, tenantId });
    if (dupErr) return dupErr;

    let state = (await getSharedState()) || {};
    const applicant = stateFindUserRecord(state, username) || {};
    const applicantManager = String(applicant?.managerUsername || '').trim();
    const adminUsername = await pickAdminUsername(state);
    const hqManagerUsername = await pickHqManagerUsername(state);
    const cashierUsername = await pickCashierUsername(state);
    const hrManagerUsername = await pickHrManagerUsername(state);

    const validationErr = await validateCreateApprovalByType({
      type,
      role,
      username,
      payload,
      state,
      applicant,
      applicantManager,
      pool,
      tenantId,
      allowedStores,
      recurringFrequencyReward,
      stateFindUserRecord,
      stateOrDbFindUserRecord,
      safeDateOnly,
      safeNumber,
      adminUsername,
    });
    if (validationErr) return validationErr;

    const applicantStore = String(applicant?.store || payload?.store || '').trim();
    const ctx = {
      state,
      applicantUsername: username,
      applicantStore,
      managerUsername: applicantManager,
      adminUsername,
      hqManagerUsername,
      hrManagerUsername,
      cashierUsername,
    };

    const assignees = await resolveCreateAssignees({
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

    const { chain, currentAssignee } = buildApprovalChain(uniq);
    const item = await insertPendingApprovalRequest({
      pool,
      type,
      username,
      chain,
      payload,
      tenantId,
    });

    try {
      state = await syncFormalPromotionTrackOnCreate({
        type,
        payload,
        state,
        item,
        saveSharedState,
        hrmsNowISO,
      });
    } catch (e) {
      log.warn({ msg: 'promotion_track_sync_on_create_failed', err: e?.message });
    }

    try {
      await notifyApprovalCreated({
        item,
        type,
        payload,
        state,
        applicant,
        username,
        currentAssignee,
        approvalTypeLabel,
        stateFindUserRecord,
        safeDateOnly,
        safeNumber,
        uniqUsernames,
        makeNotif,
        appendNotifications,
        lookupFeishuUserByUsername,
        sendLarkMessage,
      });
    } catch (e) {
      log.warn({ msg: 'approval_create_notify_failed', err: e?.message });
    }

    await saveMonthlyRecurringRewardTemplateIfNeeded({
      type,
      payload,
      recurringFrequencyReward,
      item,
      pool,
      username,
    });

    return { ok: true, item, label: approvalTypeLabel(type) };
  } catch (e) {
    return { error: 'server_error', status: 500, message: 'internal_error' };
  }
}
