import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLeaveCreate,
  validateOnboardingCreate,
  validatePromotionStageSync,
} from '../domains/approvals/create-validators.js';

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
