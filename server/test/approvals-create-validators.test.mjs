import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLeaveCreate,
  validateOnboardingCreate,
  validatePaymentFieldsSync,
  validatePointsPayloadSync,
  validatePromotionStageSync,
  validateRewardPunishmentSync,
} from '../domains/approvals/create-validators.js';

const safeNumber = (n) => {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
};

const safeDateOnly = (v) => {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

test('validateOnboardingCreate: forbidden / missing fields / exists', () => {
  assert.equal(
    validateOnboardingCreate({
      role: 'store_employee',
      applicantManager: 'm',
      payload: {},
      state: {},
      stateFindUserRecord: () => null,
      safeDateOnly,
    }).error,
    'forbidden'
  );
  assert.equal(
    validateOnboardingCreate({
      role: 'store_manager',
      applicantManager: '',
      payload: { employee: { username: 'u1', joinDate: '2026-08-01' } },
      state: {},
      stateFindUserRecord: () => null,
      safeDateOnly,
    }).error,
    'missing_manager'
  );
  const payload = { employee: { username: 'u1', joinDate: '2026-08-01' } };
  assert.equal(
    validateOnboardingCreate({
      role: 'store_manager',
      applicantManager: 'm1',
      payload,
      state: {},
      stateFindUserRecord: () => ({ username: 'u1' }),
      safeDateOnly,
    }).error,
    'employee_username_exists'
  );
  const okPayload = { employee: { username: 'u2', joinDate: '2026-08-01' } };
  assert.equal(
    validateOnboardingCreate({
      role: 'store_manager',
      applicantManager: 'm1',
      payload: okPayload,
      state: {},
      stateFindUserRecord: () => null,
      safeDateOnly,
    }),
    null
  );
  assert.equal(okPayload.employee.joinDate, '2026-08-01');
});

test('validateLeaveCreate: missing_manager / missing_leave_date / ok', () => {
  assert.equal(
    validateLeaveCreate({ applicantManager: '', payload: {}, safeDateOnly }).error,
    'missing_manager'
  );
  assert.equal(
    validateLeaveCreate({
      applicantManager: 'm',
      payload: { startDate: '2026-08-01' },
      safeDateOnly,
    }).error,
    'missing_leave_date'
  );
  assert.equal(
    validateLeaveCreate({
      applicantManager: 'm',
      payload: { startDate: '2026-08-01', endDate: '2026-08-02' },
      safeDateOnly,
    }),
    null
  );
});

test('validatePromotionStageSync: stage/reason/track', () => {
  assert.equal(
    validatePromotionStageSync({ applicantManager: '', payload: {} }).error,
    'missing_manager'
  );
  assert.equal(
    validatePromotionStageSync({
      applicantManager: 'm',
      payload: { promotionStage: 'weird', reason: 'x' },
    }).error,
    'invalid_promotion_stage'
  );
  assert.equal(
    validatePromotionStageSync({
      applicantManager: 'm',
      payload: { promotionStage: 'qualification' },
    }).error,
    'missing_reason'
  );
  assert.equal(
    validatePromotionStageSync({
      applicantManager: 'm',
      payload: { promotionStage: 'formal', reason: 'ok' },
    }).error,
    'missing_promotion_track'
  );
  const p = { promotionStage: 'qualification', reason: '表现好' };
  const r = validatePromotionStageSync({ applicantManager: 'm', payload: p });
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'qualification');
  assert.equal(p.promotionStage, 'qualification');
});

test('validatePaymentFieldsSync: forbidden / missing / front_manager store', () => {
  assert.equal(
    validatePaymentFieldsSync({
      role: 'store_employee',
      payload: {},
      applicant: {},
      allowedStores: [],
      safeDateOnly,
      safeNumber,
    }).error,
    'forbidden'
  );
  assert.equal(
    validatePaymentFieldsSync({
      role: 'store_manager',
      payload: { store: '店A', date: '2026-08-01', amount: 10 },
      applicant: {},
      allowedStores: [],
      safeDateOnly,
      safeNumber,
    }).error,
    'missing_category'
  );
  assert.equal(
    validatePaymentFieldsSync({
      role: 'front_manager',
      payload: { store: '别店', date: '2026-08-01', amount: 10, category: '物料' },
      applicant: { store: '本店' },
      allowedStores: [],
      safeDateOnly,
      safeNumber,
    }).error,
    'store_not_allowed'
  );
  const ok = validatePaymentFieldsSync({
    role: 'store_manager',
    payload: { store: '店A', date: '2026-08-01', amount: 10, category: '水电' },
    applicant: {},
    allowedStores: [],
    safeDateOnly,
    safeNumber,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.amount, 10);
});

test('validateRewardPunishmentSync / validatePointsPayloadSync', () => {
  assert.equal(
    validateRewardPunishmentSync({
      role: 'store_employee',
      payload: {},
      recurringFrequencyReward: '',
      state: {},
      stateFindUserRecord: () => null,
      safeNumber,
    }).error,
    'forbidden'
  );
  assert.equal(
    validateRewardPunishmentSync({
      role: 'store_manager',
      payload: { targetUsername: 't1', reason: 'r', result: 'ok', amount: 0 },
      recurringFrequencyReward: '',
      state: {},
      stateFindUserRecord: () => null,
      safeNumber,
    }).error,
    'missing_amount'
  );
  assert.equal(
    validateRewardPunishmentSync({
      role: 'hq_manager',
      payload: { targetUsername: 't1', reason: 'r', result: 'ok', amount: 100, rpType: '惩罚' },
      recurringFrequencyReward: 'monthly',
      state: {},
      stateFindUserRecord: () => ({ store: '店A' }),
      safeNumber,
    }).error,
    'recurring_reward_only'
  );

  assert.equal(
    validatePointsPayloadSync({
      role: 'admin',
      applicantManager: 'm',
      applicant: { store: '店A' },
      username: 'u',
      payload: {},
      state: {},
      safeNumber,
    }).error,
    'forbidden'
  );
  const payload = {
    items: [{ ruleId: 'r1', reason: '好' }],
  };
  assert.equal(
    validatePointsPayloadSync({
      role: 'store_employee',
      applicantManager: 'm',
      applicant: { store: '店A', name: '甲' },
      username: 'u1',
      payload,
      state: { pointRules: [{ id: 'r1', points: 3, itemName: '卫生', store: '店A' }] },
      safeNumber,
    }),
    null
  );
  assert.equal(payload.totalPoints, 3);
  assert.equal(payload.itemName, '卫生');
});
