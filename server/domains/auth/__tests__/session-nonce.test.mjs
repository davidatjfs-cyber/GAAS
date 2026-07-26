import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionNonceHelpers } from '../session-nonce.js';
import { createPayrollLeaveDomainSyncHelpers } from '../../payroll/domain-sync.js';

test('storeSessionNonce returns false without username', async () => {
  const { storeSessionNonce } = createSessionNonceHelpers({
    pool: { connect: async () => { throw new Error('should not connect'); } },
    resolveTenantIdDefault: () => 'default',
  });
  assert.equal(await storeSessionNonce('', 'sn'), false);
});

test('storeSessionNonce upserts and returns true', async () => {
  const queries = [];
  let released = 0;
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
    },
    release() {
      released += 1;
    },
  };
  const { storeSessionNonce } = createSessionNonceHelpers({
    pool: { connect: async () => client },
    resolveTenantIdDefault: (t) => t || 'default',
  });
  assert.equal(await storeSessionNonce('Alice', 'nonce-1', 't1'), true);
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /user_sessions/);
  assert.equal(queries[1].params[0], 'alice');
  assert.equal(queries[1].params[1], 'nonce-1');
  assert.equal(queries[1].params[2], 't1');
  assert.equal(released, 1);
});

test('storeSessionNonce：query 失败 → false；release 抛错仍吞掉', async () => {
  const client = {
    async query() {
      throw new Error('db');
    },
    release() {
      throw new Error('release');
    },
  };
  const { storeSessionNonce } = createSessionNonceHelpers({
    pool: { connect: async () => client },
    resolveTenantIdDefault: () => 'default',
  });
  assert.equal(await storeSessionNonce('bob', 'n'), false);
});
test('upsertPayrollDomainFromState writes tenant-keyed row', async () => {
  let sql = '';
  let params = null;
  const pool = {
    async query(q, p) {
      sql = q;
      params = p;
    },
  };
  const {
    upsertPayrollDomainFromState,
    upsertLeaveDomainFromState,
  } = createPayrollLeaveDomainSyncHelpers({
    pool,
    resolveTenantIdDefault: () => 'tenant-x',
    getSharedState: async () => ({}),
    notifyAdminsDualWriteFailure: () => {},
  });

  await upsertPayrollDomainFromState({
    payrollAdjustments: { a: 1 },
    payrollAudits: {},
    salaryAdjustments: [{ id: 1 }],
    monthlyConfirmations: [],
  });
  assert.match(sql, /hrms_payroll_domain/);
  assert.equal(params[0], 'tenant-x');
  assert.equal(JSON.parse(params[1]).a, 1);
  assert.equal(JSON.parse(params[3])[0].id, 1);

  await upsertLeaveDomainFromState({
    leaveBalanceOverrides: { u: 2 },
    leaveBalanceAdjustments: [],
    leaveCumulativeCloseSnapshots: { m: {} },
  });
  assert.match(sql, /hrms_leave_domain/);
  assert.equal(params[0], 'tenant-x');
  assert.equal(JSON.parse(params[1]).u, 2);
});

test('upsert* no-ops on non-object state', async () => {
  let calls = 0;
  const helpers = createPayrollLeaveDomainSyncHelpers({
    pool: { async query() { calls += 1; } },
    resolveTenantIdDefault: () => 'default',
    getSharedState: async () => null,
    notifyAdminsDualWriteFailure: () => {},
  });
  await helpers.upsertPayrollDomainFromState(null);
  await helpers.upsertLeaveDomainFromState(undefined);
  assert.equal(calls, 0);
});

test('schedulePayroll/LeaveDomainSync：成功 upsert；失败告警', async () => {
  const notified = [];
  let payrollQ = 0;
  let leaveQ = 0;
  const helpers = createPayrollLeaveDomainSyncHelpers({
    pool: {
      async query(sql) {
        if (/hrms_payroll_domain/.test(sql)) payrollQ += 1;
        if (/hrms_leave_domain/.test(sql)) leaveQ += 1;
      },
    },
    resolveTenantIdDefault: () => 'default',
    getSharedState: async () => ({ payrollAdjustments: { x: 1 }, leaveBalanceOverrides: { a: 1 } }),
    notifyAdminsDualWriteFailure: (scope) => {
      notified.push(scope);
    },
  });
  helpers.schedulePayrollDomainSync();
  helpers.scheduleLeaveDomainSync();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(payrollQ, 1);
  assert.equal(leaveQ, 1);

  const fail = createPayrollLeaveDomainSyncHelpers({
    pool: {
      async query() {
        throw new Error('pg');
      },
    },
    resolveTenantIdDefault: () => 'default',
    getSharedState: async () => ({ payrollAdjustments: {} }),
    notifyAdminsDualWriteFailure: (scope) => {
      notified.push(scope);
    },
  });
  fail.schedulePayrollDomainSync();
  fail.scheduleLeaveDomainSync();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.ok(notified.some((s) => /payroll/.test(s)));
  assert.ok(notified.some((s) => /leave/.test(s)));
});
