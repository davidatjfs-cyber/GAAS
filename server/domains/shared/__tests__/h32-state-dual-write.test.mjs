import test from 'node:test';
import assert from 'node:assert/strict';
import { createStateDualWriteHelpers } from '../state-dual-write.js';

test('dualWriteStateToDB no-ops on non-object', async () => {
  let calls = 0;
  const { dualWriteStateToDB } = createStateDualWriteHelpers({
    pool: { async query() { calls += 1; } },
    resolveTenantIdDefault: () => 'default',
    upsertEmployeesFromStateShape: async () => { calls += 1; },
    hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    toNullableUuid: (v) => v || null,
    notifyAdminsDualWriteFailure: () => {},
  });
  await dualWriteStateToDB(null);
  await dualWriteStateToDB(undefined);
  assert.equal(calls, 0);
});

test('dualWriteStateToDB：不再回灌 employees；仍写 leave / reward / notifications', async () => {
  const sqls = [];
  let empCalls = 0;
  const { dualWriteStateToDB } = createStateDualWriteHelpers({
    pool: {
      async query(sql, params) {
        sqls.push({ sql, params });
      },
    },
    resolveTenantIdDefault: () => 't1',
    upsertEmployeesFromStateShape: async () => {
      empCalls += 1;
    },
    hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    toNullableUuid: (v) => (v ? String(v) : null),
    notifyAdminsDualWriteFailure: () => {
      throw new Error('should not alert');
    },
  });

  await dualWriteStateToDB({
    employees: [{ username: 'a' }, { username: 'b' }],
    leaveRecords: [
      {
        id: 'lr1',
        applicant: 'a',
        applicantName: 'A',
        store: '洪潮',
        brand: 'hc',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        days: 2,
        type: 'leave',
        reason: 'x',
        status: 'approved',
        createdAt: '2026-07-01T00:00:00+08:00',
      },
      { id: 'bad', startDate: '', endDate: '' },
    ],
    salaryAdjustments: [
      {
        id: 'sa1',
        type: '奖励',
        targetUsername: 'a',
        targetName: 'A',
        amount: -50,
        reason: 'ok',
        approvalId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'active',
        applicantUsername: 'boss',
        createdAt: '2026-07-02T00:00:00+08:00',
      },
    ],
    notifications: [
      { targetUser: 'a', title: 't', message: 'm', type: 'system_notice', meta: { k: 1 } },
      { title: 'no-target' },
    ],
  });

  assert.equal(empCalls, 0);
  assert.ok(sqls.some((q) => /hrms_leave_records/.test(q.sql)));
  assert.ok(sqls.some((q) => /hrms_reward_punishment_records/.test(q.sql)));
  assert.ok(sqls.some((q) => /hrms_user_notifications/.test(q.sql)));
  const leave = sqls.find((q) => /hrms_leave_records/.test(q.sql));
  assert.equal(leave.params[0], 'lr1');
  const reward = sqls.find((q) => /hrms_reward_punishment_records/.test(q.sql));
  assert.equal(reward.params[5], 'reward');
  assert.equal(reward.params[7], 50);
  assert.equal(reward.params[13], 't1');
});

test('dualWriteStateToDB alerts on failure without throwing', async () => {
  let alerted = null;
  const { dualWriteStateToDB } = createStateDualWriteHelpers({
    pool: {
      async query() {
        throw new Error('db down');
      },
    },
    resolveTenantIdDefault: () => 'default',
    upsertEmployeesFromStateShape: async () => {
      throw new Error('emp fail');
    },
    hrmsNowISO: () => 'x',
    toNullableUuid: () => null,
    notifyAdminsDualWriteFailure: (label, e) => {
      alerted = { label, msg: e?.message };
    },
  });
  await dualWriteStateToDB({
    leaveRecords: [{
      id: 'lr-fail',
      applicant: 'a',
      startDate: '2026-07-01',
      endDate: '2026-07-02',
    }],
  });
  assert.match(alerted.label, /全量双写/);
  assert.equal(alerted.msg, 'db down');
});
