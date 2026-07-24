/**
 * Approval normalize helpers (type whitelist, payment flow, training periods, labels).
 * Pure helpers export as named functions; promotion periods need safeDateOnly (+ uuid).
 */
import { randomUUID as cryptoRandomUUID } from 'crypto';

export function normalizeApprovalType(input) {
  const t = String(input || '').trim().toLowerCase();
  const allowed = ['onboarding', 'offboarding', 'leave', 'payment', 'reward_punishment', 'promotion', 'points', 'monthly_confirm'];
  if (!allowed.includes(t)) return '';
  return t;
}

export function getPaymentFlowForStore(state, store) {
  const st = state && typeof state === 'object' ? state : {};
  const map = st.paymentFlowByStore && typeof st.paymentFlowByStore === 'object' ? st.paymentFlowByStore : {};
  const key = String(store || '').trim();
  const cfg = key ? map[key] : null;
  const approvers = Array.isArray(cfg?.approvers) ? cfg.approvers.map(x => String(x || '').trim()).filter(Boolean) : [];
  const cashier = String(cfg?.cashier || '').trim();
  return { approvers, cashier };
}

export function approvalTypeLabel(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'onboarding') return '入职';
  if (t === 'offboarding') return '离职';
  if (t === 'leave') return '休假';
  if (t === 'payment') return '请款';
  if (t === 'reward_punishment') return '奖惩';
  if (t === 'points') return '积分';
  if (t === 'promotion') return '晋升';
  if (t === 'monthly_confirm') return '月度考勤确认';
  return t || '审批';
}

export function createApprovalNormalizeHelpers({
  safeDateOnly,
  randomUUID: uuidFn = cryptoRandomUUID,
} = {}) {
  function normalizePromotionTrainingPeriods(input) {
    const list = Array.isArray(input) ? input : [];
    const out = [];
    const seen = new Set();
    list.forEach((x, idx) => {
      if (!x || typeof x !== 'object') return;
      const startDate = safeDateOnly(x.startDate || x.date || '');
      const endDate = safeDateOnly(x.endDate || x.date || startDate || '');
      if (!startDate || !endDate) return;
      const title = String(x.title || `培训周期${idx + 1}`).trim() || `培训周期${idx + 1}`;
      const key = `${startDate}__${endDate}__${title}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id: String(x.id || uuidFn()),
        title,
        startDate,
        endDate,
        note: String(x.note || '').trim()
      });
    });
    out.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    return out;
  }

  return {
    normalizePromotionTrainingPeriods,
    normalizeApprovalType,
    getPaymentFlowForStore,
    approvalTypeLabel,
  };
}
