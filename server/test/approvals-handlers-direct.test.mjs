import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtLeaveDate } from '../domains/approvals/handlers/shared.js';
import * as leave from '../domains/approvals/handlers/leave.js';
import * as monthlyConfirm from '../domains/approvals/handlers/monthly-confirm.js';
import * as offboarding from '../domains/approvals/handlers/offboarding.js';
import * as points from '../domains/approvals/handlers/points.js';
import * as promotion from '../domains/approvals/handlers/promotion.js';
import * as onboarding from '../domains/approvals/handlers/onboarding.js';
import * as rewardPunishment from '../domains/approvals/handlers/reward-punishment.js';
import { createPromotionRecipientsHelpers } from '../domains/approvals/promotion-recipients.js';

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function makePromotionDeps(poolQueryImpl) {
  return {
    pool: { query: poolQueryImpl || (async () => ({ rows: [] })) },
    safeDateOnly: (d) => String(d || '').slice(0, 10) || '',
    normalizePromotionTrainingPeriods: () => [],
  };
}

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

test('leave.beforeUpdate：空/非数字 remainingLeaveDays 不写；非 leave 已覆盖', async () => {
  const empty = {};
  await leave.beforeUpdate({
    row: { type: 'leave' },
    remainingLeaveDaysRaw: '',
    username: 'mgr1',
    updatedPayload: empty,
  });
  assert.deepEqual(empty, {});

  const bad = {};
  await leave.beforeUpdate({
    row: { type: 'leave' },
    remainingLeaveDaysRaw: 'NaN-ish',
    username: 'mgr1',
    updatedPayload: bad,
  });
  assert.deepEqual(bad, {});
});

test('leave.afterDecide：fromDate/toDate + autoDays；双写失败告警；拒绝无 note', async () => {
  const { deps, notifs, queries, dualWriteFails } = makeDeps();
  deps.calcDateSpanDaysInclusive = () => 3;
  deps.pool.query = async (...a) => {
    queries.push(a);
    throw new Error('dup leave');
  };

  await leave.afterDecide({
    req: { tenantId: 't1', user: {} },
    deps,
    updated: {
      id: 'appr-leave-auto',
      type: 'leave',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { fromDate: '2026-08-01', toDate: '2026-08-03', leaveReason: '年假' },
    },
    nextAssignee: null,
    note: '',
    username: 'approver1',
  });
  assert.equal(dualWriteFails.length, 1);
  assert.match(String(dualWriteFails[0][0]), /hrms_leave_records/);
  assert.ok(notifs.some((n) => n.title === '休假申请已通过'));
  assert.equal(queries[0][1][7], 3); // days 参数

  notifs.length = 0;
  const { deps: deps2, notifs: n2 } = makeDeps();
  await leave.afterDecide({
    req: {},
    deps: deps2,
    updated: {
      id: 'appr-leave-rej',
      type: 'leave',
      status: 'rejected',
      applicant_username: 'emp1',
      payload: { beginDate: '2026-08-10', finishDate: '2026-08-11' },
    },
    note: '',
    username: 'a1',
  });
  assert.ok(n2.some((n) => /相关原因/.test(n.msg)));
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

test('points.afterDecide approved multi items: amount = pts * rate，ledger 多行', async () => {
  let n = 0;
  const { deps, merges, ledgerCalls, notifs } = makeDeps({ state: {} });
  deps.randomUUID = () => `uuid-${++n}`;
  deps.resolveAttendancePayrollRules = async () => ({ rules: { pointsYuanPerPoint: 1 } });

  await points.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default', username: 'approver1' } },
    deps,
    updated: {
      id: 'appr-pts-multi',
      type: 'points',
      status: 'approved',
      applicant_username: 'emp1',
      payload: {
        store: '测试店',
        bizMonth: '2026-07',
        items: [
          { username: 'emp1', points: 10, reason: 'A', itemName: '事项A' },
          { username: 'emp2', name: '李四', points: 4, reason: 'B', store: '分店' },
        ],
      },
    },
    nextAssignee: null,
    note: '',
  });

  assert.equal(merges[0].patch.pointRecords.length, 2);
  assert.equal(merges[0].patch.pointRecords[0].amount, 10);
  assert.equal(merges[0].patch.pointRecords[1].amount, 4);
  assert.equal(merges[0].patch.pointRecords[1].username, 'emp2');
  assert.equal(ledgerCalls.length, 2);
  assert.equal(ledgerCalls[0][0].amount, 10);
  assert.equal(ledgerCalls[1][0].amount, 4);
  assert.match(notifs[0].msg, /2条积分事项/);
  assert.match(notifs[0].msg, /合计14分/);
});

test('promotion.beforeUpdate qualification store_manager approved missing mentor aborts', async () => {
  const res = makeRes();
  const updatedPayload = { promotionStage: 'qualification' };
  const out = await promotion.beforeUpdate({
    res,
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-24T12:00:00+08:00',
    approved: true,
    mentorUsernameRaw: '',
    updatedPayload,
    deps: makePromotionDeps(),
  });
  assert.equal(out?.abort, true);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'missing_mentor');
});

test('promotion.beforeUpdate qualification mentor exists sets mentor fields', async () => {
  const res = makeRes();
  const updatedPayload = { promotionStage: 'qualification' };
  const queries = [];
  await promotion.beforeUpdate({
    res,
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-24T12:00:00+08:00',
    approved: true,
    mentorUsernameRaw: 'mentor1',
    mentorNameRaw: '带教王',
    updatedPayload,
    deps: makePromotionDeps(async (...a) => {
      queries.push(a);
      return { rows: [{ ok: 1 }] };
    }),
  });
  assert.equal(res.statusCode, null);
  assert.equal(updatedPayload.mentorUsername, 'mentor1');
  assert.equal(updatedPayload.mentorName, '带教王');
  assert.equal(updatedPayload.mentorAssignedBy, 'mgr1');
  assert.equal(updatedPayload.mentorAssignedAt, '2026-07-24T12:00:00+08:00');
  assert.equal(queries.length, 1);
  assert.match(String(queries[0][0]), /from users where lower\(username\)/i);
});

test('promotion.beforeUpdate qualification mentor not found aborts', async () => {
  const res = makeRes();
  const updatedPayload = { promotionStage: 'qualification' };
  const out = await promotion.beforeUpdate({
    res,
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-24T12:00:00+08:00',
    approved: false,
    mentorUsernameRaw: 'ghost',
    updatedPayload,
    deps: makePromotionDeps(async () => ({ rows: [] })),
  });
  assert.equal(out?.abort, true);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'mentor_not_found');
});

test('promotion.beforeUpdate formal store_manager approved missing salary aborts', async () => {
  const res = makeRes();
  const updatedPayload = { promotionStage: 'formal' };
  const out = await promotion.beforeUpdate({
    res,
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-24T12:00:00+08:00',
    approved: true,
    promotedSalaryRaw: 'abc',
    updatedPayload,
    deps: makePromotionDeps(),
  });
  assert.equal(out?.abort, true);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'missing_promoted_salary');
});

test('promotion.beforeUpdate formal store_manager approved valid salary sets promotedSalary', async () => {
  const res = makeRes();
  const updatedPayload = { promotionStage: 'formal' };
  await promotion.beforeUpdate({
    res,
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-24T12:00:00+08:00',
    approved: true,
    promotedSalaryRaw: '8800.567',
    updatedPayload,
    deps: makePromotionDeps(),
  });
  assert.equal(updatedPayload.promotedSalary, 8800.57);
  assert.equal(updatedPayload.promotedSalarySetBy, 'mgr1');
  assert.equal(updatedPayload.promotedSalarySetAt, '2026-07-24T12:00:00+08:00');
});

test('onboarding.afterDecide approved build ok merges employee inserts user', async () => {
  const { deps, merges, queries } = makeDeps({ state: { employees: [] } });
  const decideExtras = {};
  const hashCalls = [];
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'newemp1',
      role: 'waiter',
      department: '前厅',
      position: '服务员',
      store: '测试店',
      salary: 5000,
      joinDate: '2026-07-24',
    },
    newUsername: 'newemp1',
    empName: '李四',
    empPassword: 'TempPass123',
  });
  deps.bcrypt = { hash: async (pw, rounds) => { hashCalls.push({ pw, rounds }); return 'hashed'; } };
  deps.toNullableUuid = () => null;
  deps.insertSalaryTimeline = async () => {};
  deps.safeErrMessage = (e) => String(e?.message || e);

  await onboarding.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default', username: 'hr1' } },
    deps,
    updated: {
      id: 'appr-onb-1',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '李四' } },
    },
    nextAssignee: null,
    note: '',
    username: 'admin1',
    decideExtras,
  });

  assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
  assert.equal(decideExtras.onboardingEmployeeSync?.username, 'newemp1');
  assert.ok(merges.some((m) => m.keys?.employees === 'username'));
  assert.equal(hashCalls.length, 1);
  assert.equal(hashCalls[0].pw, 'TempPass123');
  assert.ok(queries.some((q) => /INSERT INTO users/i.test(String(q[0]))));
});

test('onboarding.afterDecide approved build fails sets sync ok false without merge', async () => {
  const { deps, merges } = makeDeps();
  const decideExtras = {};
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({ ok: false, reason: 'duplicate_username' });
  deps.bcrypt = { hash: async () => 'hashed' };
  deps.toNullableUuid = () => null;
  deps.safeErrMessage = (e) => String(e?.message || e);

  await onboarding.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default' } },
    deps,
    updated: {
      id: 'appr-onb-2',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '王五' } },
    },
    nextAssignee: null,
    note: '',
    username: 'admin1',
    decideExtras,
  });

  assert.deepEqual(decideExtras.onboardingEmployeeSync, { ok: false, reason: 'duplicate_username' });
  assert.equal(merges.length, 0);
});

test('onboarding.afterDecide rejected sends 被拒绝 onboarding_result notification', async () => {
  const { deps, notifs } = makeDeps();

  await onboarding.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default' } },
    deps,
    updated: {
      id: 'appr-onb-3',
      type: 'onboarding',
      status: 'rejected',
      applicant_username: 'hr1',
      payload: { employee: { name: '赵六' } },
    },
    nextAssignee: null,
    note: '资料不全',
    username: 'admin1',
    decideExtras: {},
  });

  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].title, '新员工入职审批被拒绝');
  assert.equal(notifs[0].meta.type, 'onboarding_result');
  assert.match(notifs[0].msg, /赵六/);
  assert.match(notifs[0].msg, /资料不全/);
});

test('onboarding.afterDecide pending with nextAssignee sends pending notification', async () => {
  const { deps, notifs } = makeDeps();

  await onboarding.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default' } },
    deps,
    updated: {
      id: 'appr-onb-4',
      type: 'onboarding',
      status: 'pending',
      applicant_username: 'hr1',
      payload: { employee: { name: '钱七' } },
    },
    nextAssignee: 'mgr1',
    note: '',
    username: 'hr1',
    decideExtras: {},
  });

  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].u, 'mgr1');
  assert.equal(notifs[0].title, '新员工入职审批待处理');
  assert.equal(notifs[0].meta.type, 'onboarding_request');
  assert.match(notifs[0].msg, /钱七/);
});

test('onboarding.afterDecide：merge 失败 / users 失败 / 飞书成功 / 定薪 / 店长通知', async () => {
  // merge employees 失败
  {
    const { deps } = makeDeps({ state: { employees: [] } });
    const decideExtras = {};
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: true,
      nextEmp: { username: 'n1', role: 'waiter', store: '测试店' },
      newUsername: 'n1',
      empName: '甲',
      empPassword: 'p',
    });
    deps.mergeSharedStateFields = async () => {
      throw new Error('merge boom');
    };
    deps.safeErrMessage = (e) => String(e?.message || e);
    deps.bcrypt = { hash: async () => 'h' };
    deps.toNullableUuid = () => null;
    await onboarding.afterDecide({
      req: { tenantId: 'default' },
      deps,
      updated: {
        id: 'onb-m1',
        type: 'onboarding',
        status: 'approved',
        applicant_username: 'hr1',
        payload: { employee: { name: '甲' } },
      },
      username: 'admin1',
      decideExtras,
    });
    assert.equal(decideExtras.onboardingEmployeeSync?.ok, false);
    assert.equal(decideExtras.onboardingEmployeeSync?.reason, 'merge_failed');
  }

  // 成功路径：users 失败不阻断飞书/定薪；有 open_id；有店长
  {
    const timeline = [];
    const { deps, merges, queries } = makeDeps({
      state: {
        employees: [
          { username: 'sm1', store: '测试店', role: 'store_manager', name: '店长' },
        ],
      },
    });
    const decideExtras = {};
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: true,
      nextEmp: {
        username: 'new2',
        role: 'waiter',
        department: '前厅',
        position: '服务员',
        store: '测试店',
        managerUsername: 'mgr1',
        salary: 4800,
        joinDate: '2026-08-01',
      },
      newUsername: 'new2',
      empName: '乙',
      empPassword: 'Secret9',
    });
    deps.bcrypt = { hash: async () => 'hashed2' };
    deps.toNullableUuid = (v) => (v ? String(v) : null);
    deps.insertSalaryTimeline = async (args) => {
      timeline.push(args);
    };
    deps.safeErrMessage = (e) => String(e?.message || e);
    let userInserts = 0;
    deps.pool.query = async (sql, params) => {
      queries.push([sql, params]);
      if (/INSERT INTO users/i.test(sql)) {
        userInserts += 1;
        throw new Error('users conflict');
      }
      return { rows: [] };
    };

    await onboarding.afterDecide({
      req: { tenantId: 't-onb', user: { tenant_id: 't-onb' } },
      deps,
      updated: {
        id: 'onb-ok',
        type: 'onboarding',
        status: 'approved',
        applicant_username: 'hr1',
        payload: {
          employee: {
            name: '乙',
            open_id: 'ou_abc1234567890123456789012345',
          },
        },
      },
      username: 'admin1',
      decideExtras,
    });

    assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
    assert.equal(userInserts, 1);
    assert.equal(decideExtras.userAccountCreated, undefined);
    assert.equal(decideExtras.feishuUsersCreated, true);
    assert.ok(queries.some((q) => /feishu_users/i.test(String(q[0]))));
    assert.equal(timeline.length, 1);
    assert.equal(timeline[0].amount, 4800);
    assert.ok(merges.some((m) => Array.isArray(m.patch.notifications)
      && m.patch.notifications.some((n) => n.u === 'sm1')));
  }

  // 飞书写入失败不抛；定薪失败吞掉
  {
    const { deps } = makeDeps({ state: { employees: [] } });
    const decideExtras = {};
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: true,
      nextEmp: {
        username: 'new3',
        role: 'waiter',
        store: '店A',
        salary: 100,
        joinDate: '2026-08-02',
      },
      newUsername: 'new3',
      empName: '丙',
      empPassword: 'p',
    });
    deps.bcrypt = { hash: async () => 'h' };
    deps.toNullableUuid = () => 'ou_fail';
    deps.insertSalaryTimeline = async () => {
      throw new Error('timeline down');
    };
    deps.safeErrMessage = (e) => String(e?.message || e);
    deps.pool.query = async (sql) => {
      if (/feishu_users/i.test(sql)) throw new Error('feishu down');
      return { rows: [] };
    };
    await onboarding.afterDecide({
      req: { tenantId: 'default' },
      deps,
      updated: {
        id: 'onb-feishu-fail',
        type: 'onboarding',
        status: 'approved',
        applicant_username: 'hr1',
        payload: { employee: { name: '丙', openId: 'ou_fail' } },
      },
      username: 'a1',
      decideExtras,
    });
    assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
    assert.equal(decideExtras.feishuUsersCreated, undefined);
  }
});

test('reward_punishment.afterDecide approved reward: +signedAmount + ledger reward', async () => {
  const { deps, notifs, ledgerCalls, merges } = makeDeps({
    state: { salaryAdjustments: [] },
  });
  // afterDecide mutates via getSharedState only — merges not used; capture via getSharedState side effect
  let stateSnap = { salaryAdjustments: [] };
  deps.getSharedState = async () => stateSnap;
  // handler does `state = { ...state, salaryAdjustments }` locally then never mergeSharedStateFields —
  // it only uses local state for notifications. Assert ledger + notifications + pool insert.
  await rewardPunishment.afterDecide({
    req: { tenantId: 'default', user: { tenant_id: 'default' } },
    deps,
    updated: {
      id: 'appr-rp-1',
      type: 'reward_punishment',
      status: 'approved',
      applicant_username: 'mgr1',
      payload: {
        targetUsername: 'emp1',
        rpType: '奖励',
        amount: 200,
        reason: '表现优秀',
        bizMonth: '2026-07',
      },
    },
    nextAssignee: null,
    note: '',
    username: 'boss',
  });
  assert.equal(ledgerCalls.length, 1);
  assert.equal(ledgerCalls[0][0].entryType, 'reward');
  assert.equal(ledgerCalls[0][0].amount, 200);
  assert.ok(notifs.some((n) => n.meta.type === 'reward_punishment_result' && /奖励/.test(n.title)));
  void merges;
});

test('reward_punishment.afterDecide approved punishment: negative signedAmount + ledger punishment', async () => {
  const { deps, ledgerCalls } = makeDeps({ state: {} });
  await rewardPunishment.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'appr-rp-2',
      type: 'reward_punishment',
      status: 'approved',
      applicant_username: 'mgr1',
      payload: {
        employeeUsername: 'emp2',
        category: '惩罚',
        amount: 50,
        reason: '迟到',
      },
    },
    nextAssignee: null,
    note: '',
    username: 'boss',
  });
  assert.equal(ledgerCalls[0][0].entryType, 'punishment');
  assert.equal(ledgerCalls[0][0].amount, -50);
});

test('reward_punishment.afterDecide rejected notifies applicant only', async () => {
  const { deps, notifs, ledgerCalls } = makeDeps();
  await rewardPunishment.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'appr-rp-3',
      type: 'reward_punishment',
      status: 'rejected',
      applicant_username: 'mgr1',
      payload: { targetUsername: 'emp1', rpType: '奖励', amount: 10 },
    },
    nextAssignee: null,
    note: '证据不足',
    username: 'boss',
  });
  assert.equal(ledgerCalls.length, 0);
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].u, 'mgr1');
  assert.match(notifs[0].msg, /证据不足/);
});

test('isKitchenByRoleOrPosition: 出品经理与职位关键词', () => {
  const { isKitchenByRoleOrPosition } = createPromotionRecipientsHelpers({
    pickStoreRoleUsernameByStore: () => '',
    pickHqManagerUsername: async () => '',
    uniqUsernames: (a) => a,
    stateFindUserRecord: () => ({}),
  });
  assert.equal(isKitchenByRoleOrPosition('store_production_manager', '', ''), true);
  assert.equal(isKitchenByRoleOrPosition('store_employee', '后厨主管', ''), true);
  assert.equal(isKitchenByRoleOrPosition('store_employee', '服务员', '前厅'), false);
});
