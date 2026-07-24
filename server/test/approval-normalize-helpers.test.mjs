import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeApprovalType,
  getPaymentFlowForStore,
  approvalTypeLabel,
  createApprovalNormalizeHelpers,
} from '../domains/approvals/normalize-helpers.js';

function safeDateOnly(input) {
  const v = String(input || '').trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

test('normalizeApprovalType accepts whitelist and rejects invalid', () => {
  assert.equal(normalizeApprovalType('onboarding'), 'onboarding');
  assert.equal(normalizeApprovalType('LEAVE'), 'leave');
  assert.equal(normalizeApprovalType('  Promotion  '), 'promotion');
  assert.equal(normalizeApprovalType('monthly_confirm'), 'monthly_confirm');
  assert.equal(normalizeApprovalType('unknown'), '');
  assert.equal(normalizeApprovalType(''), '');
  assert.equal(normalizeApprovalType(null), '');
});

test('getPaymentFlowForStore handles missing map, empty approvers, cashier trim', () => {
  assert.deepEqual(getPaymentFlowForStore(null, 'A'), { approvers: [], cashier: '' });
  assert.deepEqual(getPaymentFlowForStore({}, 'A'), { approvers: [], cashier: '' });
  assert.deepEqual(
    getPaymentFlowForStore({ paymentFlowByStore: { A: { approvers: [' a ', '', 'b'], cashier: '  c  ' } } }, 'A'),
    { approvers: ['a', 'b'], cashier: 'c' }
  );
  assert.deepEqual(
    getPaymentFlowForStore({ paymentFlowByStore: { A: { approvers: 'nope', cashier: null } } }, 'A'),
    { approvers: [], cashier: '' }
  );
  assert.deepEqual(getPaymentFlowForStore({ paymentFlowByStore: { A: {} } }, '  '), {
    approvers: [],
    cashier: '',
  });
});

test('approvalTypeLabel known labels and fallback', () => {
  assert.equal(approvalTypeLabel('onboarding'), '入职');
  assert.equal(approvalTypeLabel('OFFBOARDING'), '离职');
  assert.equal(approvalTypeLabel('leave'), '休假');
  assert.equal(approvalTypeLabel('payment'), '请款');
  assert.equal(approvalTypeLabel('reward_punishment'), '奖惩');
  assert.equal(approvalTypeLabel('points'), '积分');
  assert.equal(approvalTypeLabel('promotion'), '晋升');
  assert.equal(approvalTypeLabel('monthly_confirm'), '月度考勤确认');
  assert.equal(approvalTypeLabel('custom_x'), 'custom_x');
  assert.equal(approvalTypeLabel(''), '审批');
  assert.equal(approvalTypeLabel(null), '审批');
});

test('normalizePromotionTrainingPeriods dedupes, sorts, skips bad dates, uses mocks', () => {
  let n = 0;
  const { normalizePromotionTrainingPeriods } = createApprovalNormalizeHelpers({
    safeDateOnly,
    randomUUID: () => `uuid-${++n}`,
  });

  const out = normalizePromotionTrainingPeriods([
    { startDate: '2026-02-01', endDate: '2026-02-10', title: 'B', note: ' n ' },
    { startDate: '2026-01-01', endDate: '2026-01-05', title: 'A' },
    { startDate: '2026-02-01', endDate: '2026-02-10', title: 'B' }, // dup
    { startDate: 'bad', endDate: '2026-03-01', title: 'skip' },
    { date: '2026-03-01', title: '  ' }, // fallback date + default title
    null,
    'x',
    { id: 'keep-id', startDate: '2026-04-01', endDate: '2026-04-02', title: 'C' },
  ]);

  assert.deepEqual(out, [
    { id: 'uuid-2', title: 'A', startDate: '2026-01-01', endDate: '2026-01-05', note: '' },
    { id: 'uuid-1', title: 'B', startDate: '2026-02-01', endDate: '2026-02-10', note: 'n' },
    { id: 'uuid-3', title: '培训周期5', startDate: '2026-03-01', endDate: '2026-03-01', note: '' },
    { id: 'keep-id', title: 'C', startDate: '2026-04-01', endDate: '2026-04-02', note: '' },
  ]);
});

test('normalizePromotionTrainingPeriods non-array input yields empty', () => {
  const { normalizePromotionTrainingPeriods } = createApprovalNormalizeHelpers({ safeDateOnly });
  assert.deepEqual(normalizePromotionTrainingPeriods(null), []);
  assert.deepEqual(normalizePromotionTrainingPeriods({}), []);
});

test('factory returns same pure helpers as named exports', () => {
  const helpers = createApprovalNormalizeHelpers({ safeDateOnly });
  assert.equal(helpers.normalizeApprovalType, normalizeApprovalType);
  assert.equal(helpers.getPaymentFlowForStore, getPaymentFlowForStore);
  assert.equal(helpers.approvalTypeLabel, approvalTypeLabel);
});
