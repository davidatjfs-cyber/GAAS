import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInactiveStatus,
  employeeAccountShouldDisable,
  createAccountGateHelpers,
} from '../account-gate.js';

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
  assert.equal(employeeAccountShouldDisable({ status: 'active', offboardingApproved: false }), false);
  assert.equal(employeeAccountShouldDisable({ status: 'active', offboardingApproved: ' true ' }), true);
  assert.equal(employeeAccountShouldDisable({ status: 'active', offboardingApproved: ' 1 ' }), true);
  assert.equal(
    employeeAccountShouldDisable({ status: 'active', offboardingApproved: true, offboardingDate: '' }),
    true
  );

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
  assert.equal(
    employeeAccountShouldDisable({
      status: 'active',
      offboardingApproved: true,
      offboardingDate: `${past}T23:59:59`,
    }),
    true
  );
  assert.equal(
    employeeAccountShouldDisable({
      status: 'active',
      offboardingApproved: true,
      offboardingDate: `  ${past}  `,
    }),
    true
  );

  const today = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
  assert.equal(
    employeeAccountShouldDisable({
      status: 'active',
      offboardingApproved: true,
      offboardingDate: today,
    }),
    true
  );
  assert.equal(
    employeeAccountShouldDisable({
      status: 'active',
      offboardingApproved: true,
      offboardingDate: ' 2099-12-31',
    }),
    false
  );
  assert.equal(
    employeeAccountShouldDisable({
      status: 'active',
      offboardingApproved: true,
      extra_json: { offboardingDate: past },
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
  const disableUsers = queries.find((q) => /UPDATE users SET is_active = FALSE/i.test(q.sql));
  const disableFeishu = queries.find((q) => /UPDATE feishu_users SET registered = FALSE/i.test(q.sql));
  assert.deepEqual(disableUsers?.params, ['alice']);
  assert.deepEqual(disableFeishu?.params, ['alice']);
  assert.equal(storeNonceCalls.length, 1);
  assert.equal(storeNonceCalls[0].uname, 'alice');
  assert.equal(storeNonceCalls[0].sn, 'aabbccddeeff1122');
});

test('applyHrmsUserAccountGateFromEmployee null emp is no-op', async () => {
  const { applyHrmsUserAccountGateFromEmployee, queries } = makeGate();
  await applyHrmsUserAccountGateFromEmployee(null);
  assert.equal(queries.length, 0);
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

test('applyHrmsUserAccountGateFromEmployee trims username and passes SQL params', async () => {
  const { applyHrmsUserAccountGateFromEmployee, queries, tenantRuns } = makeGate();
  await applyHrmsUserAccountGateFromEmployee({
    username: '  alice  ',
    status: 'active',
    role: 'cashier',
    store: '店A',
    name: 'Alice',
  });

  const tenantLookup = queries.find((q) => /SELECT tenant_id FROM users/i.test(q.sql));
  assert.deepEqual(tenantLookup?.params, ['alice']);
  for (const q of queries.filter((x) => /UPDATE (users|feishu_users)/i.test(x.sql))) {
    assert.equal(q.params[0], 'alice');
  }
  assert.deepEqual(tenantRuns, ['t1']);
});

test('applyHrmsUserAccountGateFromEmployee enable defaults empty role/store/name', async () => {
  const { applyHrmsUserAccountGateFromEmployee, queries } = makeGate();
  await applyHrmsUserAccountGateFromEmployee({ username: 'min', status: 'active' });
  const feishuEnable = queries.find((q) => /SET registered = TRUE/i.test(q.sql));
  assert.deepEqual(feishuEnable?.params, ['min', '', '', '']);
});

test('applyHrmsUserAccountGateFromEmployee no-op without username or DATABASE_URL', async () => {
  const noUser = makeGate();
  await noUser.applyHrmsUserAccountGateFromEmployee({ status: '离职' });
  assert.equal(noUser.queries.length, 0);

  const noDb = makeGate({ DATABASE_URL: '' });
  await noDb.applyHrmsUserAccountGateFromEmployee({ username: 'alice', status: '离职' });
  assert.equal(noDb.queries.length, 0);
});

test('applyHrmsUserAccountGateFromEmployee falls back to default tenant', async () => {
  const pool = {
    query: async (sql) => {
      if (/SELECT tenant_id FROM users/i.test(sql)) {
        return { rows: [{ tenant_id: '  ' }] };
      }
      return { rows: [] };
    },
  };
  const { applyHrmsUserAccountGateFromEmployee, tenantRuns } = makeGate({ pool });
  await applyHrmsUserAccountGateFromEmployee({ username: 'zoe', status: 'active' });
  assert.deepEqual(tenantRuns, ['default']);
});

test('applyHrmsUserAccountGateFromEmployee uses default when tenant_id missing', async () => {
  const pool = {
    query: async (sql) => {
      if (/SELECT tenant_id FROM users/i.test(sql)) {
        return { rows: [{ tenant_id: null }] };
      }
      return { rows: [] };
    },
  };
  const { applyHrmsUserAccountGateFromEmployee, tenantRuns } = makeGate({ pool });
  await applyHrmsUserAccountGateFromEmployee({ username: 'zoe', status: 'active' });
  assert.deepEqual(tenantRuns, ['default']);
});

test('applyHrmsUserAccountGateFromEmployee uses default when rows missing', async () => {
  const pool = {
    query: async (sql) => {
      if (/SELECT tenant_id FROM users/i.test(sql)) {
        return { rows: undefined };
      }
      return { rows: [] };
    },
  };
  const { applyHrmsUserAccountGateFromEmployee, tenantRuns } = makeGate({ pool });
  await applyHrmsUserAccountGateFromEmployee({ username: 'zoe', status: 'active' });
  assert.deepEqual(tenantRuns, ['default']);
});

test('applyHrmsUserAccountGateFromEmployee uses default when rows is null', async () => {
  const pool = {
    query: async (sql) => {
      if (/SELECT tenant_id FROM users/i.test(sql)) {
        return { rows: null };
      }
      return { rows: [] };
    },
  };
  const { applyHrmsUserAccountGateFromEmployee, tenantRuns } = makeGate({ pool });
  await applyHrmsUserAccountGateFromEmployee({ username: 'zoe', status: 'active' });
  assert.deepEqual(tenantRuns, ['default']);
});

test('applyHrmsUserAccountGateFromEmployee tenant lookup failure uses default', async () => {
  const pool = {
    query: async (sql) => {
      if (/SELECT tenant_id FROM users/i.test(sql)) throw new Error('db down');
      return { rows: [] };
    },
  };
  const { applyHrmsUserAccountGateFromEmployee, tenantRuns } = makeGate({ pool });
  await applyHrmsUserAccountGateFromEmployee({ username: 'zoe', status: 'active' });
  assert.deepEqual(tenantRuns, ['default']);
});

test('applyHrmsUserAccountGateFromEmployee swallows sync errors', async () => {
  const pool = {
    query: async (sql) => {
      if (/SELECT tenant_id FROM users/i.test(sql)) return { rows: [{ tenant_id: 't1' }] };
      throw new Error('update failed');
    },
  };
  const { applyHrmsUserAccountGateFromEmployee } = makeGate({ pool });
  await assert.doesNotReject(() =>
    applyHrmsUserAccountGateFromEmployee({ username: 'err', status: '离职' })
  );
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

test('assertEmployeeLoginAllowedByState allows active employee', async () => {
  const activeRec = { username: 'ok', status: 'active' };
  const { assertEmployeeLoginAllowedByState } = makeGate({
    getSharedState: async () => ({ employees: [activeRec] }),
    stateFindUserRecord: (_st, un) => (un === 'ok' ? activeRec : null),
  });
  await assert.doesNotReject(() => assertEmployeeLoginAllowedByState('ok'));
  await assert.doesNotReject(() => assertEmployeeLoginAllowedByState('  ok  '));
});

test('assertEmployeeLoginAllowedByState tolerates getSharedState failure', async () => {
  const { assertEmployeeLoginAllowedByState } = makeGate({
    getSharedState: async () => {
      throw new Error('state unavailable');
    },
    stateFindUserRecord: () => null,
  });
  await assert.doesNotReject(() => assertEmployeeLoginAllowedByState('x'));
});

test('assertEmployeeLoginAllowedByState treats null state as empty', async () => {
  let seenState;
  const { assertEmployeeLoginAllowedByState } = makeGate({
    getSharedState: async () => null,
    stateFindUserRecord: (st) => {
      seenState = st;
      return null;
    },
  });
  await assert.doesNotReject(() => assertEmployeeLoginAllowedByState('ghost'));
  assert.deepEqual(seenState, {});
});

test('assertEmployeeLoginAllowedByState ignores empty username', async () => {
  const { assertEmployeeLoginAllowedByState } = makeGate({
    stateFindUserRecord: () => ({ username: '', status: '离职' }),
  });
  await assert.doesNotReject(() => assertEmployeeLoginAllowedByState(''));
  await assert.doesNotReject(() => assertEmployeeLoginAllowedByState('   '));
});
