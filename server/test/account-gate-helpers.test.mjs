import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInactiveStatus,
  employeeAccountShouldDisable,
  createAccountGateHelpers,
} from '../domains/employees/account-gate.js';

test('isInactiveStatus list', () => {
  for (const v of ['inactive', 'disabled', 'disable', 'off', '0', 'resigned', 'leave', 'left', '离职', '禁用', '停用', ' Inactive ', '离职']) {
    assert.equal(isInactiveStatus(v), true, v);
  }
  assert.equal(isInactiveStatus(''), false);
  assert.equal(isInactiveStatus(null), false);
  assert.equal(isInactiveStatus('active'), false);
  assert.equal(isInactiveStatus('在职'), false);
});

test('employeeAccountShouldDisable inactive / offboarding / future date', () => {
  assert.equal(employeeAccountShouldDisable(null), false);
  assert.equal(employeeAccountShouldDisable({ status: '离职' }), true);
  assert.equal(employeeAccountShouldDisable({ status: 'active', offboardingApproved: true }), true);
  assert.equal(employeeAccountShouldDisable({ status: 'active', offboardingApproved: 'true' }), true);
  assert.equal(employeeAccountShouldDisable({ status: 'active', offboardingApproved: '1' }), true);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2);
  const future = tomorrow.toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
  assert.equal(
    employeeAccountShouldDisable({
      status: 'active',
      offboardingApproved: true,
      offboardingDate: future,
    }),
    false
  );

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 2);
  const past = yesterday.toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
  assert.equal(
    employeeAccountShouldDisable({
      status: 'active',
      offboardingApproved: true,
      offboardingDate: past,
    }),
    true
  );
});

function makeGate(overrides = {}) {
  const queries = [];
  const storeNonceCalls = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT tenant_id FROM users/i.test(sql)) {
        return { rows: [{ tenant_id: 't1' }] };
      }
      return { rows: [] };
    },
  };
  const tenantRuns = [];
  const helpers = createAccountGateHelpers({
    pool,
    DATABASE_URL: 'postgres://test',
    tenantContext: {
      run: async (tenantId, fn) => {
        tenantRuns.push(tenantId);
        return fn();
      },
    },
    storeSessionNonce: async (uname, sn) => {
      storeNonceCalls.push({ uname, sn });
      return true;
    },
    randomUUID: () => 'aabbccdd-eeff-1122-3344-556677889900',
    getSharedState: async () => ({ employees: [] }),
    stateFindUserRecord: () => null,
    ...overrides,
  });
  return { ...helpers, queries, storeNonceCalls, tenantRuns };
}

test('applyHrmsUserAccountGateFromEmployee disable SQL shape', async () => {
  const { applyHrmsUserAccountGateFromEmployee, queries, storeNonceCalls, tenantRuns } = makeGate();
  await applyHrmsUserAccountGateFromEmployee({
    username: 'alice',
    status: '离职',
    role: 'store_employee',
    store: '店A',
    name: 'Alice',
  });

  assert.deepEqual(tenantRuns, ['t1']);
  assert.ok(queries.some((q) => /UPDATE users SET is_active = FALSE/i.test(q.sql)));
  assert.ok(queries.some((q) => /UPDATE feishu_users SET registered = FALSE/i.test(q.sql)));
  assert.equal(storeNonceCalls.length, 1);
  assert.equal(storeNonceCalls[0].uname, 'alice');
  assert.equal(storeNonceCalls[0].sn, 'aabbccddeeff1122');
});

test('applyHrmsUserAccountGateFromEmployee enable SQL shape', async () => {
  const { applyHrmsUserAccountGateFromEmployee, queries, storeNonceCalls } = makeGate();
  await applyHrmsUserAccountGateFromEmployee({
    username: 'bob',
    status: 'active',
    role: 'store_manager',
    store: '店B',
    name: 'Bob',
  });

  assert.ok(queries.some((q) => /UPDATE users SET is_active = TRUE/i.test(q.sql)));
  const feishuEnable = queries.find((q) => /SET registered = TRUE/i.test(q.sql));
  assert.ok(feishuEnable);
  assert.deepEqual(feishuEnable.params, ['bob', 'store_manager', '店B', 'Bob']);
  assert.equal(storeNonceCalls.length, 0);
});

test('assertEmployeeLoginAllowedByState throws 403 when disabled', async () => {
  const { assertEmployeeLoginAllowedByState } = makeGate({
    getSharedState: async () => ({ employees: [{ username: 'x', status: '离职' }] }),
    stateFindUserRecord: (_st, un) => (un === 'x' ? { username: 'x', status: '离职' } : null),
  });
  await assert.rejects(
    () => assertEmployeeLoginAllowedByState('x'),
    (err) => err.message === 'account_disabled' && err.statusCode === 403
  );
});

test('assertEmployeeLoginAllowedByState no-op when missing', async () => {
  const { assertEmployeeLoginAllowedByState } = makeGate({
    getSharedState: async () => ({ employees: [] }),
    stateFindUserRecord: () => null,
  });
  await assert.doesNotReject(() => assertEmployeeLoginAllowedByState('ghost'));
  await assert.doesNotReject(() => assertEmployeeLoginAllowedByState(''));
});
