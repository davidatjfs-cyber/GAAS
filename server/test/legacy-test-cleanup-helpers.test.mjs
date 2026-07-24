import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLegacyTestUsername,
  cleanupLegacyTestState,
  LEGACY_TEST_USERNAMES,
  LEGACY_TEST_EMPLOYEE_IDS,
} from '../domains/shared/legacy-test-cleanup.js';

test('isLegacyTestUsername matches known set case-insensitively', () => {
  assert.equal(isLegacyTestUsername(''), false);
  assert.equal(isLegacyTestUsername('admin'), false);
  assert.equal(isLegacyTestUsername('store_emp1'), true);
  assert.equal(isLegacyTestUsername(' STORE_EMP1 '), true);
  assert.equal(LEGACY_TEST_USERNAMES.has('emp1'), true);
});

test('cleanupLegacyTestState strips users/employees/points/salary/payroll', () => {
  const { state, changed } = cleanupLegacyTestState({
    users: [{ username: 'admin' }, { username: 'store_emp1' }],
    employees: [
      { username: 'keep', id: 'E100' },
      { username: 'hq_mgr1', id: 'X' },
      { username: 'ok', id: 'EMP001' },
    ],
    pointRecords: [{ username: 'emp1' }, { username: 'real' }],
    salaryAdjustments: [
      { targetUsername: 'store_mgr1', applicantUsername: 'admin' },
      { targetUsername: 'a', applicantUsername: 'b' },
    ],
    payrollAdjustments: {
      '2026-01||店||store_prod1': { username: 'store_prod1' },
      '2026-01||店||keep': { username: 'keep' },
      'bad-key': { username: 'emp1' },
    },
    other: 1,
  });

  assert.equal(changed, true);
  assert.deepEqual(state.users, [{ username: 'admin' }]);
  assert.deepEqual(state.employees, [{ username: 'keep', id: 'E100' }]);
  assert.deepEqual(state.pointRecords, [{ username: 'real' }]);
  assert.deepEqual(state.salaryAdjustments, [{ targetUsername: 'a', applicantUsername: 'b' }]);
  assert.deepEqual(state.payrollAdjustments, {
    '2026-01||店||keep': { username: 'keep' },
  });
  assert.equal(state.other, 1);
  assert.ok(LEGACY_TEST_EMPLOYEE_IDS.has('EMP001'));
});

test('cleanupLegacyTestState no-op when clean', () => {
  const input = {
    users: [{ username: 'admin' }],
    employees: [{ username: 'keep', id: 'E1' }],
    pointRecords: [],
    salaryAdjustments: [],
    payrollAdjustments: { '2026-01||店||keep': { username: 'keep' } },
  };
  const { state, changed } = cleanupLegacyTestState(input);
  assert.equal(changed, false);
  assert.deepEqual(state.users, input.users);
  assert.deepEqual(state.payrollAdjustments, input.payrollAdjustments);
});

test('cleanupLegacyTestState empty/non-object input', () => {
  const a = cleanupLegacyTestState(null);
  assert.equal(a.changed, false);
  assert.deepEqual(a.state.users, undefined);
  const b = cleanupLegacyTestState({});
  assert.equal(b.changed, false);
  assert.deepEqual(b.state.payrollAdjustments, {});
});
