import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtLeaveDate } from '../domains/approvals/handlers/shared.js';
import * as leave from '../domains/approvals/handlers/leave.js';
import * as monthlyConfirm from '../domains/approvals/handlers/monthly-confirm.js';
import * as offboarding from '../domains/approvals/handlers/offboarding.js';
import * as points from '../domains/approvals/handlers/points.js';

function makeDeps(overrides = {}) {
  const notifs = [];
  const merges = [];
  const queries = [];
  const ledgerCalls = [];
  const dualWriteFails = [];

  const deps = {
    pool: {
      query: async (...a) => {
        queries.push(a);
        return { rows: [] };
      },
    },
    hrmsNowISO: () => '2026-07-24T12:00:00+08:00',
    makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
    appendNotifications: async (arr) => {
      notifs.push(...arr);
    },
    getSharedState: async () => overrides.state || {},
    mergeSharedStateFields: async (patch, keys) => {
      merges.push({ patch, keys });
    },
    stateFindUserRecord: (_s, u) => ({
      username: u,
      name: '张三',
      managerUsername: 'mgr1',
      store: '测试店',
      brand: '洪潮',
    }),
    uniqUsernames: (arr) => [...new Set(arr)],
    safeDateOnly: (d) => String(d || '').slice(0, 10) || '',
    safeNumber: (n) => {
      const x = Number(n);
      return Number.isFinite(x) ? x : null;
    },
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    calcDateSpanDaysInclusive: () => 2,
    notifyAdminsDualWriteFailure: (...a) => {
      dualWriteFails.push(a);
    },
    safeBizMonth: (s) => String(s || '').slice(0, 7) || '2026-07',
    upsertPayrollLedgerEntry: async (...a) => {
      ledgerCalls.push(a);
    },
    resolveAttendancePayrollRules: async () => ({ rules: { pointsYuanPerPoint: 0.5 } }),
    shanghaiTodayDateOnly: () => '2026-07-24',
    ...overrides.depsExtra,
  };

  return { deps, notifs, merges, queries, ledgerCalls, dualWriteFails };
}

test('fmtLeaveDate formats normal date and empty', () => {
  assert.equal(fmtLeaveDate('2026-07-01'), '7月1日');
  assert.equal(fmtLeaveDate('2026-12-25'), '12月25日');
  assert.equal(fmtLeaveDate(''), '');
  assert.equal(fmtLeaveDate(null), '');
});

test('leave.beforeUpdate fills remainingLeaveDays for leave type', async () => {
  const updatedPayload = {};
  await leave.beforeUpdate({
    row: { type: 'leave' },
    remainingLeaveDaysRaw: '5',
    username: 'mgr1',
    updatedPayload,
  });
  assert.equal(updatedPayload.remainingLeaveDays, 5);
  assert.equal(updatedPayload.remainingLeaveDaysFilledBy, 'mgr1');
});

test('leave.beforeUpdate no-op for non-leave type', async () => {
  const updatedPayload = {};
  await leave.beforeUpdate({
    row: { type: 'points' },
    remainingLeaveDaysRaw: '5',
    username: 'mgr1',
    updatedPayload,
  });
  assert.deepEqual(updatedPayload, {});
});

test('leave.afterDecide approved pushes record, pool insert, leave_result notification', async () => {
  const { deps, notifs, queries } = makeDeps({
    state: { leaveRecords: [{ id: 'old' }] },
  });
  let getStateCalls = 0;
  deps.getSharedState = async () => {
    getStateCalls += 1;
    return { leaveRecords: [{ id: 'old' }] };
  };

  await leave.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default', username: 'approver1' } },
    deps,
    updated: {
      id: 'appr-leave-1',
      type: 'leave',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { startDate: '2026-07-01', endDate: '2026-07-02', days: 2, reason: '事假' },
    },
    nextAssignee: null,
    note: '',
    username: 'approver1',
  });

  assert.ok(getStateCalls >= 1);
  assert.equal(queries.length, 1);
  assert.match(String(queries[0][0]), /INSERT INTO hrms_leave_records/i);
  assert.equal(notifs.length, 2);
  assert.ok(notifs.every((n) => n.meta?.type === 'leave_result'));
  assert.ok(notifs.some((n) => n.title === '休假申请已通过'));
  assert.match(notifs[0].msg, /已经审批通过/);
});

test('leave.afterDecide rejected sends 未通过 leave_result without pool insert', async () => {
  const { deps, notifs, queries } = makeDeps();

  await leave.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default' } },
    deps,
    updated: {
      id: 'appr-leave-2',
      type: 'leave',
      status: 'rejected',
      applicant_username: 'emp1',
      payload: { startDate: '2026-07-01', endDate: '2026-07-02' },
    },
    nextAssignee: null,
    note: '人手不足',
    username: 'approver1',
  });

  assert.equal(queries.length, 0);
  assert.equal(notifs.length, 2);
  assert.ok(notifs.every((n) => n.meta?.type === 'leave_result'));
  assert.ok(notifs.some((n) => n.title === '休假申请未通过'));
  assert.match(notifs[0].msg, /没有审批通过/);
});

test('leave.afterDecide pending with nextAssignee sends leave_request', async () => {
  const { deps, notifs, queries } = makeDeps();

  await leave.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default' } },
    deps,
    updated: {
      id: 'appr-leave-3',
      type: 'leave',
      status: 'pending',
      applicant_username: 'emp1',
      payload: {},
    },
    nextAssignee: 'mgr1',
    note: '',
    username: 'emp1',
  });

  assert.equal(queries.length, 0);
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].meta.type, 'leave_request');
  assert.equal(notifs[0].u, 'mgr1');
  assert.equal(notifs[0].title, '休假申请待审批');
});

test('monthly-confirm.afterDecide approved merges status and notifies monthly_confirm_result', async () => {
  const mc = {
    id: 'mc-1',
    status: 'pending',
    history: [],
  };
  const { deps, notifs, merges } = makeDeps({
    state: { monthlyConfirmations: [mc] },
  });

  await monthlyConfirm.afterDecide({
    req: { user: { username: 'admin1' } },
    deps,
    updated: {
      id: 'appr-mc-1',
      type: 'monthly_confirm',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { confirmationId: 'mc-1', month: '2026-06', store: '测试店' },
    },
    nextAssignee: null,
    note: '',
  });

  assert.equal(mc.status, 'approved');
  assert.equal(merges.length, 1);
  assert.equal(merges[0].keys.monthlyConfirmations, 'id');
  assert.equal(merges[0].patch.monthlyConfirmations[0].status, 'approved');
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].meta.type, 'monthly_confirm_result');
  assert.equal(notifs[0].title, '月度考勤确认已通过');
});

test('monthly-confirm.afterDecide rejected sets status and note in history', async () => {
  const mc = {
    id: 'mc-2',
    status: 'pending',
    history: [],
  };
  const { deps, notifs, merges } = makeDeps({
    state: { monthlyConfirmations: [mc] },
  });

  await monthlyConfirm.afterDecide({
    req: { user: { username: 'admin1' } },
    deps,
    updated: {
      id: 'appr-mc-2',
      type: 'monthly_confirm',
      status: 'rejected',
      applicant_username: 'hr1',
      payload: { confirmationId: 'mc-2', month: '2026-06', store: '测试店' },
    },
    nextAssignee: null,
    note: '数据有误',
  });

  assert.equal(mc.status, 'rejected');
  assert.equal(merges.length, 1);
  const lastHistory = mc.history[mc.history.length - 1];
  assert.equal(lastHistory.action, 'rejected');
  assert.equal(lastHistory.note, '数据有误');
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].meta.type, 'monthly_confirm_result');
  assert.match(notifs[0].msg, /被驳回：数据有误/);
});

test('offboarding.beforeUpdate beforeChain sets departureType', async () => {
  const updatedPayload = {};
  const { deps } = makeDeps();
  await offboarding.beforeUpdate({
    row: { type: 'offboarding' },
    departureType: 'voluntary',
    updatedPayload,
    nextStatus: 'pending',
    beforeChain: true,
    deps,
  });
  assert.equal(updatedPayload.departureType, 'voluntary');
});

test('offboarding.beforeUpdate post-chain sets effectiveDate from resignDate when approved', async () => {
  const updatedPayload = { resignDate: '2026-08-01' };
  const ctx = {
    row: { type: 'offboarding' },
    departureType: '',
    updatedPayload,
    nextStatus: 'approved',
    beforeChain: false,
    deps: makeDeps().deps,
  };
  await offboarding.beforeUpdate(ctx);
  assert.equal(ctx.effectiveDate, '2026-08-01');
});

test('points.afterDecide approved single payload merges records and calls ledger/pool', async () => {
  const { deps, notifs, merges, queries, ledgerCalls } = makeDeps({ state: {} });

  await points.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default', username: 'approver1' } },
    deps,
    updated: {
      id: 'appr-pts-1',
      type: 'points',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { points: 10, itemName: '优秀服务', reason: '顾客表扬', store: '测试店', bizMonth: '2026-07' },
    },
    nextAssignee: null,
    note: '',
  });

  assert.equal(merges.length, 1);
  assert.ok(Array.isArray(merges[0].patch.pointRecords));
  assert.equal(merges[0].patch.pointRecords.length, 1);
  assert.equal(merges[0].patch.pointsAppliedApprovals['appr-pts-1'], true);
  assert.equal(ledgerCalls.length, 1);
  assert.equal(queries.length, 1);
  assert.match(String(queries[0][0]), /INSERT INTO point_records/i);
  assert.ok(notifs.some((n) => n.meta?.type === 'points_result' && n.title === '积分申请已通过'));
});

test('points.afterDecide rejected sends 未通过 points_result notification', async () => {
  const { deps, notifs, merges, queries } = makeDeps();

  await points.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default', username: 'approver1' } },
    deps,
    updated: {
      id: 'appr-pts-2',
      type: 'points',
      status: 'rejected',
      applicant_username: 'emp1',
      payload: { points: 10 },
    },
    nextAssignee: null,
    note: '证据不足',
  });

  assert.equal(merges.length, 0);
  assert.equal(queries.length, 0);
  assert.ok(notifs.some((n) => n.meta?.type === 'points_result' && n.title === '积分申请未通过'));
  assert.match(notifs[0].msg, /未通过审批/);
});

test('points.afterDecide alreadyApplied skips new pointRecords merge but still notifies', async () => {
  const { deps, notifs, merges, queries, ledgerCalls } = makeDeps({
    state: { pointsAppliedApprovals: { 'appr-pts-3': true } },
  });

  await points.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default', username: 'approver1' } },
    deps,
    updated: {
      id: 'appr-pts-3',
      type: 'points',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { points: 10, itemName: '重复审批' },
    },
    nextAssignee: null,
    note: '',
  });

  assert.equal(merges.length, 0);
  assert.equal(queries.length, 0);
  assert.equal(ledgerCalls.length, 0);
  assert.ok(notifs.some((n) => n.meta?.type === 'points_result' && n.title === '积分申请已通过'));
});
