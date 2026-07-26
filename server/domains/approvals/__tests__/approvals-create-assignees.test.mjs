import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHeadquarterApplicant,
  resolveCreateAssignees,
  uniqAssignees,
} from '../create-assignees.js';

test('isHeadquarterApplicant / uniqAssignees', () => {
  assert.equal(isHeadquarterApplicant('hq_manager', '门店A'), true);
  assert.equal(isHeadquarterApplicant('store_employee', '马己仙'), false);
  assert.equal(isHeadquarterApplicant('waiter', '总部办公室'), true);
  assert.deepEqual(uniqAssignees(['a', 'A', '', 'b', 'a']), ['a', 'b']);
});

test('resolveCreateAssignees: leave 总部 vs 门店；promotion 厨房', async () => {
  const base = {
    payload: {},
    state: {},
    ctx: {},
    applicantManager: 'mgr1',
    adminUsername: 'admin1',
    hqManagerUsername: 'hq1',
    hrManagerUsername: 'hr1',
    cashierUsername: 'cash1',
    applicantStore: '测试店',
    getPaymentFlowForStore: () => ({ approvers: [] }),
    pickStoreRoleUsernameByStore: (_s, _store, roles) =>
      (roles.includes('store_production_manager') ? 'pm1' : ''),
    isKitchenByRoleOrPosition: () => false,
    resolveDutyApproverForStore: async () => 'sm1',
  };

  const leaveStore = await resolveCreateAssignees({
    ...base,
    type: 'leave',
    applicant: { role: 'store_employee', store: '测试店' },
    role: 'store_employee',
  });
  assert.deepEqual(leaveStore, ['mgr1', 'hq1', 'hr1']);

  const leaveHq = await resolveCreateAssignees({
    ...base,
    type: 'leave',
    applicant: { role: 'hq_manager', store: '总部' },
    role: 'hq_manager',
  });
  assert.deepEqual(leaveHq, ['mgr1', 'hr1']);

  const promoKitchen = await resolveCreateAssignees({
    ...base,
    type: 'promotion',
    payload: { promotionStage: 'qualification' },
    applicant: { role: 'store_employee', store: '测试店', position: '厨工', department: '厨房' },
    role: 'store_employee',
    isKitchenByRoleOrPosition: () => true,
  });
  assert.deepEqual(promoKitchen, ['pm1', 'sm1']);

  const onboarding = await resolveCreateAssignees({
    ...base,
    type: 'onboarding',
    applicant: { role: 'store_manager', store: '测试店' },
    role: 'store_manager',
  });
  assert.deepEqual(onboarding, ['mgr1', 'hr1', 'admin1']);

  const paymentFlow = await resolveCreateAssignees({
    ...base,
    type: 'payment',
    payload: { store: '测试店' },
    applicant: { role: 'store_manager', store: '测试店' },
    role: 'store_manager',
    getPaymentFlowForStore: () => ({ approvers: ['c1', 'a1'] }),
  });
  assert.deepEqual(paymentFlow, ['c1', 'a1']);
});
