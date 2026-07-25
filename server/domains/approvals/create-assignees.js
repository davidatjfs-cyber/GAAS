/**
 * createApproval 审批链解析（可单测）。
 */
import {
  buildConfiguredApprovalAssignees,
  resolveStoreApprovalRoleUsername,
} from '../../approval-assignee-resolution.js';

export function isHeadquarterApplicant(applicantRole, applicantStore) {
  const role = String(applicantRole || '').trim().toLowerCase();
  const storeLower = String(applicantStore || '').trim().toLowerCase();
  return (
    role === 'admin'
    || role === 'hq_manager'
    || role === 'hr_manager'
    || role === 'cashier'
    || role.startsWith('custom_')
    || storeLower.includes('总部')
    || storeLower.includes('headquarter')
    || storeLower.includes('hq')
  );
}

/**
 * @returns {Promise<string[]>}
 */
export async function resolveCreateAssignees({
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
}) {
  const applicantRole = String(applicant?.role || role || '').trim().toLowerCase();
  const hqApplicant = isHeadquarterApplicant(applicantRole, applicant?.store);

  if (type === 'payment') {
    const configured = await buildConfiguredApprovalAssignees(state, type, ctx, resolveDutyApproverForStore);
    if (configured.length) return configured;
    const store = String(payload?.store || '').trim();
    const flow = getPaymentFlowForStore(state, store);
    if (flow.approvers.length) return flow.approvers;
    return [applicantManager, cashierUsername, adminUsername].filter(Boolean);
  }

  if (type === 'leave') {
    return hqApplicant
      ? [applicantManager, hrManagerUsername].filter(Boolean)
      : [applicantManager, hqManagerUsername, hrManagerUsername].filter(Boolean);
  }

  if (type === 'promotion') {
    const stage = String(payload?.promotionStage || 'qualification').trim().toLowerCase();
    const applicantStoreName = String(applicant?.store || payload?.store || '').trim();
    const storeManagerByStore = await resolveStoreApprovalRoleUsername(
      state,
      applicantStoreName,
      ['store_manager'],
      resolveDutyApproverForStore
    );
    if (stage === 'qualification') {
      const applicantPosition = String(applicant?.position || payload?.currentPosition || '').trim();
      const applicantDepartment = String(applicant?.department || payload?.department || '').trim();
      const kitchenApplicant = isKitchenByRoleOrPosition(applicantRole, applicantPosition, applicantDepartment);
      const productionManagerByStore = pickStoreRoleUsernameByStore(
        state,
        applicantStoreName,
        ['store_production_manager']
      );
      return kitchenApplicant
        ? [productionManagerByStore, storeManagerByStore].filter(Boolean)
        : [storeManagerByStore].filter(Boolean);
    }
    return [storeManagerByStore, hqManagerUsername, hrManagerUsername].filter(Boolean);
  }

  const configured = await buildConfiguredApprovalAssignees(state, type, ctx, resolveDutyApproverForStore);
  if (configured.length) return configured;

  if (type === 'onboarding') {
    return [applicantManager, hrManagerUsername, adminUsername].filter(Boolean);
  }
  if (type === 'offboarding') {
    return [applicantManager, hqManagerUsername, hrManagerUsername].filter(Boolean);
  }
  if (type === 'reward_punishment') {
    return [applicantManager, hrManagerUsername].filter(Boolean);
  }
  if (type === 'points') {
    const storeManagerForPoints = await resolveStoreApprovalRoleUsername(
      state,
      applicantStore,
      ['store_manager'],
      resolveDutyApproverForStore
    );
    return [storeManagerForPoints, hqManagerUsername, hrManagerUsername].filter(Boolean);
  }
  return [applicantManager, adminUsername].filter(Boolean);
}

/** 去重保序 */
export function uniqAssignees(assignees) {
  const seen = new Set();
  const uniq = [];
  (assignees || []).forEach((a) => {
    const k = String(a || '').trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    uniq.push(String(a || '').trim());
  });
  return uniq;
}
