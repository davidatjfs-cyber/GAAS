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

test('points.afterDecide pending with nextAssignee sends points_request', async () => {
  const { deps, notifs } = makeDeps();
  await points.afterDecide({
    req: { tenantId: 'default', user: {} },
    deps,
    updated: {
      id: 'appr-pts-pend',
      type: 'points',
      status: 'pending',
      applicant_username: 'emp1',
      payload: { points: 8, itemName: '卫生检查' },
    },
    nextAssignee: 'mgr1',
    note: '',
  });
  assert.equal(notifs.length, 1);
  assert.equal(notifs[0].u, 'mgr1');
  assert.equal(notifs[0].meta.type, 'points_request');
  assert.equal(notifs[0].title, '积分申请待审批');
});

test('points.afterDecide：双写失败告警；ledger 失败仍 merge/通知；rules 抛错回落 0.5', async () => {
  // dual-write fail
  {
    const { deps, notifs, dualWriteFails, merges } = makeDeps();
    deps.pool.query = async () => {
      throw new Error('point_records down');
    };
    await points.afterDecide({
      req: { tenantId: 'default', user: { username: 'a1' } },
      deps,
      updated: {
        id: 'appr-pts-dw',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { points: 4, itemName: '巡店', store: '测试店', bizMonth: '2026-07' },
      },
      nextAssignee: null,
      note: '',
    });
    assert.equal(dualWriteFails.length, 1);
    assert.match(String(dualWriteFails[0][0]), /point_records/);
    assert.ok(merges.some((m) => m.patch.pointsAppliedApprovals?.['appr-pts-dw']));
    assert.ok(notifs.some((n) => n.title === '积分申请已通过'));
  }

  // ledger fail still notifies
  {
    const { deps, notifs, merges, ledgerCalls } = makeDeps();
    deps.upsertPayrollLedgerEntry = async () => {
      ledgerCalls.push('boom');
      throw new Error('ledger down');
    };
    await points.afterDecide({
      req: { tenantId: 'default', user: { username: 'a1' } },
      deps,
      updated: {
        id: 'appr-pts-led',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { points: 2, itemName: '表扬', store: '测试店', bizMonth: '2026-07' },
      },
      nextAssignee: null,
      note: '',
    });
    assert.equal(ledgerCalls.length, 1);
    assert.ok(merges.length >= 1);
    assert.ok(notifs.some((n) => n.title === '积分申请已通过'));
  }

  // rules throw → rate 0.5
  {
    const { deps, merges } = makeDeps();
    deps.resolveAttendancePayrollRules = async () => {
      throw new Error('rules down');
    };
    await points.afterDecide({
      req: { tenantId: 'default', user: { username: 'a1' } },
      deps,
      updated: {
        id: 'appr-pts-rate',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { points: 10, itemName: '默认汇率', store: '测试店', bizMonth: '2026-07' },
      },
      nextAssignee: null,
      note: '',
    });
    assert.equal(merges[0].patch.pointRecords[0].amount, 5);
  }
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

test('onboarding.afterDecide：通知 merge 失败不抛；仍保留员工同步成功', async () => {
  const { deps } = makeDeps({
    state: { employees: [{ username: 'sm1', store: '测试店', role: 'store_manager' }] },
  });
  const decideExtras = {};
  let notifMergeAttempts = 0;
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'new4',
      role: 'waiter',
      store: '测试店',
      managerUsername: 'mgr1',
      salary: 0,
      joinDate: '2026-08-03',
    },
    newUsername: 'new4',
    empName: '丁',
    empPassword: 'p',
  });
  deps.bcrypt = { hash: async () => 'h' };
  deps.toNullableUuid = () => null;
  deps.insertSalaryTimeline = async () => {};
  deps.safeErrMessage = (e) => String(e?.message || e);
  deps.mergeSharedStateFields = async (patch, _keys) => {
    if (patch.notifications) {
      notifMergeAttempts += 1;
      throw new Error('notif merge boom');
    }
  };
  await onboarding.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'onb-notif-fail',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '丁' } },
    },
    username: 'a1',
    decideExtras,
  });
  assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
  assert.equal(notifMergeAttempts, 1);
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

test('reward_punishment.afterDecide pending+nextAssignee；双写失败；无 target 只通知申请人', async () => {
  const { deps: pendingDeps, notifs: pendingNotifs } = makeDeps();
  await rewardPunishment.afterDecide({
    req: { tenantId: 'default' },
    deps: pendingDeps,
    updated: {
      id: 'appr-rp-pend',
      type: 'reward_punishment',
      status: 'pending',
      applicant_username: 'mgr1',
      payload: { targetUsername: 'emp1', rpType: '奖励', amount: 20 },
    },
    nextAssignee: 'hq1',
    note: '',
    username: 'boss',
  });
  assert.equal(pendingNotifs.length, 1);
  assert.equal(pendingNotifs[0].u, 'hq1');
  assert.equal(pendingNotifs[0].meta.type, 'reward_punishment_request');

  const dualFails = [];
  const ledgerFails = [];
  const { deps: failDeps, notifs: failNotifs, dualWriteFails } = makeDeps({
    depsExtra: {
      pool: {
        query: async () => {
          throw new Error('dual_write_boom');
        },
      },
      upsertPayrollLedgerEntry: async () => {
        ledgerFails.push(1);
        throw new Error('ledger_boom');
      },
      notifyAdminsDualWriteFailure: (...a) => dualFails.push(a),
    },
  });
  await rewardPunishment.afterDecide({
    req: { tenantId: 'default' },
    deps: failDeps,
    updated: {
      id: 'appr-rp-fail',
      type: 'reward_punishment',
      status: 'approved',
      applicant_username: 'mgr1',
      payload: { targetUsername: 'emp1', rpType: '奖励', amount: 30, reason: '好' },
    },
    nextAssignee: null,
    note: '',
    username: 'boss',
  });
  assert.equal(dualFails.length, 1);
  assert.match(String(dualFails[0][0]), /hrms_reward_punishment_records/);
  assert.equal(ledgerFails.length, 1);
  assert.ok(failNotifs.some((n) => n.u === 'emp1'));
  void dualWriteFails;

  const { deps: noTargetDeps, notifs: noTargetNotifs, ledgerCalls } = makeDeps();
  await rewardPunishment.afterDecide({
    req: { tenantId: 'default' },
    deps: noTargetDeps,
    updated: {
      id: 'appr-rp-nt',
      type: 'reward_punishment',
      status: 'approved',
      applicant_username: 'mgr1',
      payload: { rpType: '奖励', amount: 15, reason: '自奖' },
    },
    nextAssignee: null,
    note: '',
    username: 'boss',
  });
  assert.equal(ledgerCalls.length, 1);
  assert.ok(noTargetNotifs.every((n) => n.u === 'mgr1' || n.meta.type === 'reward_punishment_result'));
  assert.ok(noTargetNotifs.some((n) => n.u === 'mgr1' && /已审批通过/.test(n.msg)));
  assert.equal(noTargetNotifs.filter((n) => n.title === '奖励通知').length, 0);
});

test('monthly-confirm.afterDecide pending；无 confirmationId 静默；payload JSON 字符串可解析', async () => {
  const { deps: pendDeps, notifs: pendNotifs, merges: pendMerges } = makeDeps({
    state: {
      employees: [{ username: 'hr1', name: '人事甲' }],
      monthlyConfirmations: [],
    },
  });
  pendDeps.stateFindUserRecord = (_s, u) =>
    (u === 'hr1' ? { username: 'hr1', name: '人事甲' } : { username: u });
  await monthlyConfirm.afterDecide({
    req: { user: { username: 'admin1' } },
    deps: pendDeps,
    updated: {
      id: 'appr-mc-pend',
      type: 'monthly_confirm',
      status: 'pending',
      applicant_username: 'hr1',
      payload: { month: '2026-07', store: '测试店' },
    },
    nextAssignee: 'hq1',
    note: '',
  });
  assert.equal(pendMerges.length, 0);
  assert.equal(pendNotifs.length, 1);
  assert.equal(pendNotifs[0].u, 'hq1');
  assert.equal(pendNotifs[0].meta.type, 'monthly_confirm_request');
  assert.match(pendNotifs[0].msg, /人事甲/);

  const { deps: noIdDeps, notifs: noIdNotifs, merges: noIdMerges } = makeDeps({
    state: { monthlyConfirmations: [{ id: 'other', status: 'pending', history: [] }] },
  });
  await monthlyConfirm.afterDecide({
    req: { user: { username: 'admin1' } },
    deps: noIdDeps,
    updated: {
      id: 'appr-mc-noid',
      type: 'monthly_confirm',
      status: 'approved',
      applicant_username: 'hr1',
      payload: JSON.stringify({ month: '2026-07', store: '洪潮' }),
    },
    nextAssignee: null,
    note: '',
  });
  assert.equal(noIdMerges.length, 0);
  assert.equal(noIdNotifs.length, 0);

  const mc = { id: 'mc-json', status: 'pending', history: [] };
  const { deps: jsonDeps, notifs: jsonNotifs, merges: jsonMerges } = makeDeps({
    state: { monthlyConfirmations: [mc] },
  });
  await monthlyConfirm.afterDecide({
    req: { user: { username: 'admin1' } },
    deps: jsonDeps,
    updated: {
      id: 'appr-mc-json',
      type: 'monthly_confirm',
      status: 'approved',
      applicant_username: 'hr1',
      payload: JSON.stringify({
        confirmationId: 'mc-json',
        month: '2026-07',
        store: '洪潮',
      }),
    },
    nextAssignee: null,
    note: '',
  });
  assert.equal(mc.status, 'approved');
  assert.equal(jsonMerges.length, 1);
  assert.equal(jsonNotifs.length, 1);
  assert.match(jsonNotifs[0].msg, /洪潮/);
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

test('leave.afterDecide：非 leave 早退；days 空；pending 无 nextAssignee', async () => {
  const { deps, notifs, queries } = makeDeps();
  await leave.afterDecide({
    req: {},
    deps,
    updated: { id: 'x', type: 'points', status: 'approved', applicant_username: 'emp1', payload: {} },
    username: 'a1',
  });
  assert.equal(notifs.length, 0);
  assert.equal(queries.length, 0);

  await leave.afterDecide({ req: {}, deps, updated: null, username: 'a1' });
  assert.equal(notifs.length, 0);

  deps.calcDateSpanDaysInclusive = () => null;
  await leave.afterDecide({
    req: { tenantId: 't1' },
    deps,
    updated: {
      id: 'leave-empty-days',
      type: 'leave',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { reason: '事假' },
    },
    username: 'a1',
  });
  assert.ok(notifs.some((n) => n.title === '休假申请已通过'));
  assert.equal(queries[0][1][7], 0);

  notifs.length = 0;
  await leave.afterDecide({
    req: {},
    deps,
    updated: {
      id: 'leave-pend-none',
      type: 'leave',
      status: 'pending',
      applicant_username: 'emp1',
      payload: {},
    },
    nextAssignee: null,
    username: 'a1',
  });
  assert.equal(notifs.length, 0);
});

test('points.afterDecide：items 空数组回落单条；负数 rate；pending 多条文案；早退', async () => {
  const { deps, notifs, ledgerCalls } = makeDeps();
  deps.resolveAttendancePayrollRules = async () => ({ rules: { pointsYuanPerPoint: -1 } });

  await points.afterDecide({
    req: { tenantId: 't1', user: { username: 'boss' } },
    deps,
    updated: {
      id: 'pts-empty-items',
      type: 'points',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { items: [], points: 4, itemName: '单条回落', store: '测试店' },
      created_at: '2026-06-01T00:00:00+08:00',
    },
    note: '',
  });
  assert.equal(ledgerCalls.length, 1);
  assert.equal(ledgerCalls[0][0].points, 4);
  assert.equal(ledgerCalls[0][0].amount, 2); // 0.5 * 4
  assert.ok(notifs.some((n) => /单条回落/.test(n.msg)));

  notifs.length = 0;
  await points.afterDecide({
    req: { user: { username: 'boss' } },
    deps,
    updated: {
      id: 'pts-pend-multi',
      type: 'points',
      status: 'pending',
      applicant_username: 'emp1',
      payload: {
        items: [
          { username: 'emp1', points: 1, reason: 'a' },
          { username: 'emp1', points: 2, reason: 'b' },
        ],
      },
    },
    nextAssignee: 'mgr1',
  });
  assert.ok(notifs.some((n) => /2条积分事项/.test(n.msg)));

  notifs.length = 0;
  await points.afterDecide({
    req: {},
    deps,
    updated: {
      id: 'pts-rej-nonote',
      type: 'points',
      status: 'rejected',
      applicant_username: 'emp1',
      payload: { points: 1 },
    },
    note: '',
  });
  assert.ok(notifs.some((n) => /相关原因/.test(n.msg)));

  notifs.length = 0;
  await points.afterDecide({
    req: {},
    deps,
    updated: { id: 'x', type: 'leave', status: 'approved', applicant_username: 'emp1', payload: {} },
  });
  assert.equal(notifs.length, 0);
  await points.afterDecide({ req: {}, deps, updated: null });
  assert.equal(notifs.length, 0);
});

test('leave.afterDecide：leaveReason/beginDate 别名；reqDays 优先；外层 catch 吞错', async () => {
  const { deps, notifs, queries } = makeDeps({
    state: {
      leaveRecords: [],
    },
  });
  deps.stateFindUserRecord = () => ({
    username: 'emp1',
    name: '',
    managerUsername: '',
    store: '洪潮',
    brand: '洪潮',
    department: '前厅',
    position: '服务员',
  });
  deps.calcDateSpanDaysInclusive = () => 9;
  await leave.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'leave-alias',
      type: 'leave',
      status: 'approved',
      applicant_username: 'emp1',
      payload: {
        beginDate: '2026-09-01',
        finishDate: '2026-09-03',
        leaveReason: '病假',
        leaveDays: 2,
      },
    },
    username: 'mgr1',
  });
  assert.equal(queries[0][1][7], 2); // reqDays 优先于 autoDays
  assert.ok(notifs.some((n) => /病假|休假申请已通过/.test(n.title + n.msg)));

  const { deps: d2, notifs: n2 } = makeDeps();
  d2.getSharedState = async () => {
    throw new Error('state boom');
  };
  await leave.afterDecide({
    req: {},
    deps: d2,
    updated: {
      id: 'leave-catch',
      type: 'leave',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { startDate: '2026-09-01', endDate: '2026-09-01' },
    },
    username: 'a1',
  });
  assert.equal(n2.length, 0);
});

test('points.afterDecide：approvedAt 空串；month 回落 hrmsNow；单条 pending 文案', async () => {
  const { deps, notifs, queries } = makeDeps();
  deps.hrmsNowISO = () => '2026-05-15T12:00:00+08:00';
  deps.randomUUID = () => 'uuid-pts-empty-at';
  // force approvedAt === '' path in pool insert
  const origISO = deps.hrmsNowISO;
  deps.hrmsNowISO = () => '';
  await points.afterDecide({
    req: { tenantId: 't1', user: { username: 'boss' } },
    deps: {
      ...deps,
      hrmsNowISO: () => '',
      randomUUID: () => 'uuid-pts-empty-at',
      safeBizMonth: () => '',
    },
    updated: {
      id: 'pts-empty-at',
      type: 'points',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { points: 1, itemName: '空时间' },
    },
  });
  assert.ok(queries.some((q) => /INSERT INTO point_records/i.test(String(q[0]))));
  const insertParams = queries.find((q) => /INSERT INTO point_records/i.test(String(q[0])))[1];
  assert.equal(insertParams[9], null); // approved_at

  notifs.length = 0;
  await points.afterDecide({
    req: { user: { username: 'boss' } },
    deps: { ...deps, hrmsNowISO: origISO },
    updated: {
      id: 'pts-pend-one',
      type: 'points',
      status: 'pending',
      applicant_username: 'emp1',
      payload: { points: 3, itemName: '单条待审' },
    },
    nextAssignee: 'mgr1',
  });
  assert.ok(notifs.some((n) => n.title === '积分申请待审批' && /单条待审/.test(n.msg)));
});

test('onboarding.afterDecide：salary≤0 跳过 timeline；无店长；pending 无 nextAssignee', async () => {
  const { deps } = makeDeps();
  const timeline = [];
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'newzero',
      name: '零薪',
      role: 'store_employee',
      department: '',
      position: '',
      store: '',
      managerUsername: '',
      salary: 0,
    },
    newUsername: 'newzero',
    empName: '零薪',
    empPassword: 'Temp1234',
  });
  deps.bcrypt = { hash: async () => 'hash' };
  deps.toNullableUuid = () => null;
  deps.insertSalaryTimeline = async (a) => {
    timeline.push(a);
  };
  deps.safeErrMessage = (e) => String(e?.message || e);
  const decideExtras = {};
  await onboarding.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'onb-zero-sal',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '零薪' } },
    },
    username: 'a1',
    decideExtras,
  });
  assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
  assert.equal(timeline.length, 0);

  const { deps: d2, notifs: n2 } = makeDeps();
  await onboarding.afterDecide({
    req: {},
    deps: d2,
    updated: {
      id: 'onb-pend-none',
      type: 'onboarding',
      status: 'pending',
      applicant_username: 'hr1',
      payload: { employee: { name: '庚' } },
    },
    nextAssignee: null,
    decideExtras: {},
  });
  assert.equal(n2.length, 0);
});

test('onboarding.afterDecide：employee 非 object；users 成功 flag；rejected 无 note；外层 notify 吞错', async () => {
  const { deps } = makeDeps();
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'newemp2',
      name: '丁',
      role: 'store_employee',
      department: '',
      position: '',
      store: '测试店',
      managerUsername: 'mgr1',
      salary: 0,
    },
    newUsername: 'newemp2',
    empName: '丁',
    empPassword: 'Temp1234',
  });
  deps.bcrypt = { hash: async () => 'hash' };
  deps.toNullableUuid = () => null;
  deps.insertSalaryTimeline = async () => {};
  deps.safeErrMessage = (e) => String(e?.message || e);

  const decideExtras = {};
  await onboarding.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'onb-no-emp',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: 'not-an-object' },
    },
    username: 'a1',
    decideExtras,
  });
  assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
  assert.equal(decideExtras.userAccountCreated, true);

  const { deps: d2, notifs: n2 } = makeDeps();
  await onboarding.afterDecide({
    req: {},
    deps: d2,
    updated: {
      id: 'onb-rej',
      type: 'onboarding',
      status: 'rejected',
      applicant_username: 'hr1',
      payload: { employee: { name: '戊' } },
    },
    note: '',
    decideExtras: {},
  });
  assert.ok(n2.some((n) => n.title === '新员工入职审批被拒绝' && !/：/.test(n.msg)));

  const { deps: d3, notifs: n3 } = makeDeps();
  d3.appendNotifications = async () => {
    throw new Error('notify boom');
  };
  await onboarding.afterDecide({
    req: {},
    deps: d3,
    updated: {
      id: 'onb-pend-err',
      type: 'onboarding',
      status: 'pending',
      applicant_username: 'hr1',
      payload: { employee: { name: '己' } },
    },
    nextAssignee: 'mgr1',
    decideExtras: {},
  });
  assert.equal(n3.length, 0);

  await onboarding.afterDecide({
    req: {},
    deps: d3,
    updated: { id: 'x', type: 'leave', status: 'approved', applicant_username: 'hr1', payload: {} },
    decideExtras: {},
  });
});

test('onboarding.afterDecide：非法 salary/joinDate；有门店无店长；非法 open_id 跳过飞书', async () => {
  const timeline = [];
  const { deps, queries, merges } = makeDeps({
    state: {
      employees: [
        { username: 'other', store: '甲店', role: 'store_employee' },
      ],
    },
  });
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'newbad',
      name: '坏薪',
      role: 'store_employee',
      department: '',
      position: '',
      store: '甲店',
      managerUsername: 'mgr1',
      salary: 'bad',
      joinDate: 'not-a-date',
    },
    newUsername: 'newbad',
    empName: '坏薪',
    empPassword: 'Temp1234',
  });
  deps.bcrypt = { hash: async () => 'hash' };
  deps.toNullableUuid = () => null;
  deps.safeDateOnly = () => '';
  deps.hrmsNowISO = () => '2026-07-25T08:00:00+08:00';
  deps.insertSalaryTimeline = async (a) => {
    timeline.push(a);
  };
  deps.safeErrMessage = (e) => String(e?.message || e);

  const decideExtras = {};
  await onboarding.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'onb-bad-sal',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '坏薪', open_id: 'not-uuid' } },
    },
    username: 'a1',
    decideExtras,
  });
  assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
  assert.equal(decideExtras.userAccountCreated, true);
  assert.equal(timeline.length, 0);
  assert.equal(queries.some((q) => /feishu_users/i.test(String(q[0]))), false);
  const notifMerge = merges.find((m) => Array.isArray(m.patch.notifications));
  const recipients = (notifMerge?.patch.notifications || []).map((n) => n.u);
  assert.ok(recipients.includes('hr1'));
  assert.ok(recipients.includes('mgr1'));
  assert.equal(recipients.includes('store_mgr'), false);
});

test('points.afterDecide：NaN rate 回落 0.5；item 字段回落；第2条双写失败仍通知', async () => {
  let uuidSeq = 0;
  const { deps, notifs, ledgerCalls, dualWriteFails, queries, merges } = makeDeps({
    depsExtra: {
      randomUUID: () => `00000000-0000-4000-8000-00000000000${++uuidSeq}`,
      resolveAttendancePayrollRules: async () => ({ rules: { pointsYuanPerPoint: Number.NaN } }),
    },
  });
  let insertCount = 0;
  deps.pool.query = async (...a) => {
    queries.push(a);
    if (/INSERT INTO point_records/i.test(String(a[0]))) {
      insertCount += 1;
      if (insertCount >= 2) throw new Error('second insert boom');
    }
    return { rows: [] };
  };

  await points.afterDecide({
    req: { tenantId: 'default', user: { username: 'approver1' } },
    deps,
    updated: {
      id: 'pts-fallback',
      type: 'points',
      status: 'approved',
      applicant_username: 'emp1',
      created_at: '2026-06-15T00:00:00+08:00',
      payload: {
        store: '默认店',
        items: [
          { points: 2 },
          { points: 4, username: 'other', name: '李四', store: '乙店', itemName: '', reason: '', bizMonth: '' },
        ],
      },
    },
  });

  assert.equal(ledgerCalls.length, 2);
  assert.equal(ledgerCalls[0][0].amount, 1);
  assert.equal(ledgerCalls[1][0].amount, 2);
  assert.equal(ledgerCalls[0][0].username, 'emp1');
  assert.equal(ledgerCalls[0][0].store, '默认店');
  assert.equal(ledgerCalls[0][0].title, '积分事项');
  assert.equal(dualWriteFails.length, 1);
  assert.ok(notifs.some((n) => n.title === '积分申请已通过'));
  assert.ok(merges.some((m) => m.patch.pointsAppliedApprovals?.['pts-fallback'] === true));
  const firstInsert = queries.find((q) => /INSERT INTO point_records/i.test(String(q[0])));
  assert.ok(firstInsert);
  assert.ok(firstInsert[1][9]);
});

test('promotion.afterDecide：oldSalary=0 跳过 timeline 仍调 next-month；拒轨不存在不抛', async () => {
  const timeline = [];
  const salaryCalls = [];
  const { deps, merges } = makeDeps({
    state: {
      employees: [{
        username: 'emp1',
        name: '员工',
        level: '初级',
        position: '服务员',
        salary: 0,
        store: '测试店',
        department: '前厅',
        promotionHistory: null,
      }],
      promotionTracks: [],
    },
  });
  deps.findUserSalary = () => 0;
  deps.insertSalaryTimeline = async (a) => {
    timeline.push(a);
  };
  deps.applyPromotionSalaryNextMonth = async (a) => {
    salaryCalls.push(a);
  };
  deps.getPromotionRequiredTopics = async () => [];
  deps.getPromotionTrackProgress = async () => ({ items: [] });
  deps.createTrainingAssignment = async () => {};
  deps.normalizePromotionTrainingPeriods = () => [];
  deps.isKitchenByRoleOrPosition = () => false;
  deps.pickHqManagerUsername = async () => '';
  deps.pickStoreRoleUsernameByStore = () => '';
  deps.safeErrMessage = (e) => String(e?.message || e);

  await promotion.afterDecide({
    req: { tenantId: 'default', user: {} },
    deps,
    username: 'approver1',
    note: '',
    nextAssignee: null,
    updated: {
      id: 'ap-zero-sal',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'emp1',
      chain: [],
      payload: {
        promotionStage: 'formal',
        promoTier: 'level_promotion',
        newLevel: '中级',
        newPosition: '',
        promotedSalary: 6000,
        promotionTrackId: 'missing-track',
      },
    },
  });
  assert.equal(timeline.length, 0);
  assert.equal(salaryCalls.length, 1);
  assert.equal(salaryCalls[0].newSalary, 6000);
  assert.ok(merges.some((m) => Array.isArray(m.patch.employees?.[0]?.promotionHistory)));

  const rej = makeDeps({
    state: {
      employees: [{ username: 'emp1', name: '员工', store: '测试店' }],
      promotionTracks: [{ id: 'gone', status: 'qualification_approved' }],
    },
  });
  rej.deps.findUserSalary = () => null;
  rej.deps.insertSalaryTimeline = async () => {};
  rej.deps.applyPromotionSalaryNextMonth = async () => {};
  rej.deps.getPromotionRequiredTopics = async () => [];
  rej.deps.getPromotionTrackProgress = async () => ({ items: [] });
  rej.deps.createTrainingAssignment = async () => {};
  rej.deps.normalizePromotionTrainingPeriods = () => [];
  rej.deps.isKitchenByRoleOrPosition = () => false;
  rej.deps.pickHqManagerUsername = async () => '';
  rej.deps.pickStoreRoleUsernameByStore = () => '';
  rej.deps.mergeSharedStateFields = async () => {
    throw new Error('merge boom');
  };

  await promotion.afterDecide({
    req: { tenantId: 'default' },
    deps: rej.deps,
    username: 'approver1',
    note: '不够格',
    nextAssignee: null,
    updated: {
      id: 'ap-rej-missing-track',
      type: 'promotion',
      status: 'rejected',
      applicant_username: 'emp1',
      payload: {
        promotionStage: 'formal',
        promotionTrackId: 'gone',
      },
    },
  });
  assert.ok(rej.notifs.some((n) => n.title === '晋升申请未通过'));
});

test('onboarding.afterDecide：正薪 + joinDate 回落 hrmsNow；有店长进通知名单', async () => {
  const timeline = [];
  const { deps, merges } = makeDeps({
    state: {
      employees: [
        { username: 'sm1', store: '甲店', role: 'store_manager', name: '店长甲' },
      ],
    },
  });
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'newpay',
      name: '有薪',
      role: 'store_employee',
      department: '',
      position: '',
      store: '甲店',
      managerUsername: 'mgr1',
      salary: 8000,
      joinDate: '',
    },
    newUsername: 'newpay',
    empName: '有薪',
    empPassword: 'Temp1234',
  });
  deps.bcrypt = { hash: async () => 'hash' };
  deps.toNullableUuid = () => null;
  deps.safeDateOnly = () => '';
  deps.hrmsNowISO = () => '2026-07-26T09:00:00+08:00';
  deps.insertSalaryTimeline = async (a) => {
    timeline.push(a);
  };
  deps.safeErrMessage = (e) => String(e?.message || e);

  await onboarding.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'onb-pay',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '有薪' } },
    },
    username: 'a1',
    decideExtras: {},
  });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].amount, 8000);
  assert.equal(timeline[0].effectiveFrom, '2026-07-26');
  const recipients = (merges.find((m) => Array.isArray(m.patch.notifications))?.patch.notifications || [])
    .map((n) => n.u);
  assert.ok(recipients.includes('sm1'));
  assert.ok(recipients.includes('hr1'));
  assert.ok(recipients.includes('mgr1'));
});

test('points.afterDecide：pointsAppliedApprovals 缺失仍入账；空 approvalId 不误判已应用', async () => {
  const { deps, ledgerCalls, merges } = makeDeps({
    state: {},
  });
  await points.afterDecide({
    req: { tenantId: 'default', user: { username: 'approver1' } },
    deps,
    updated: {
      id: '',
      type: 'points',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { points: 3, itemName: '空ID积分', store: '测试店' },
    },
  });
  assert.equal(ledgerCalls.length, 1);
  assert.equal(ledgerCalls[0][0].points, 3);
  assert.ok(merges.some((m) => m.patch.pointsAppliedApprovals?.[''] === true));
});

test('promotion.afterDecide：pending 且 nextAssignee 无档案 → 不附带教提示', async () => {
  const { deps, notifs } = makeDeps();
  deps.stateFindUserRecord = () => null;
  deps.findUserSalary = () => null;
  deps.insertSalaryTimeline = async () => {};
  deps.applyPromotionSalaryNextMonth = async () => {};
  deps.getPromotionRequiredTopics = async () => [];
  deps.getPromotionTrackProgress = async () => ({ items: [] });
  deps.createTrainingAssignment = async () => {};
  deps.normalizePromotionTrainingPeriods = () => [];
  deps.isKitchenByRoleOrPosition = () => false;
  deps.pickHqManagerUsername = async () => '';
  deps.pickStoreRoleUsernameByStore = () => '';

  await promotion.afterDecide({
    req: { tenantId: 'default' },
    deps,
    username: 'approver1',
    nextAssignee: 'unknown_mgr',
    updated: {
      id: 'ap-pend-no-rec',
      type: 'promotion',
      status: 'pending',
      applicant_username: 'emp1',
      payload: { promotionStage: 'qualification' },
    },
  });
  const n = notifs.find((x) => x.title === '晋升申请待审批');
  assert.ok(n);
  assert.equal(/带教人/.test(n.msg), false);
});

test('onboarding.beforeUpdate no-op；afterDecide 边界：feishuOpenId / tenant 回落 / 空店长名 / 空员工名', async () => {
  await onboarding.beforeUpdate({});

  const queries = [];
  const timeline = [];
  const { deps, merges } = makeDeps({
    state: {
      employees: [
        { username: '  ', store: '乙店', role: 'store_manager' },
        { username: 'cook1', store: '乙店', role: 'store_employee' },
      ],
    },
  });
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'newoid',
      name: '飞书入职',
      role: 'store_employee',
      department: '前厅',
      position: '服务员',
      store: '乙店',
      managerUsername: '',
      salary: 5000,
      joinDate: '2026-08-01',
    },
    newUsername: 'newoid',
    empName: '飞书入职',
    empPassword: 'Temp9999',
  });
  deps.bcrypt = { hash: async () => 'hash' };
  deps.toNullableUuid = (v) => (String(v || '').startsWith('oid-') ? String(v) : null);
  deps.safeDateOnly = (d) => String(d || '').slice(0, 10) || '';
  deps.insertSalaryTimeline = async (a) => {
    timeline.push(a);
  };
  deps.pool.query = async (...a) => {
    queries.push(a);
    return { rows: [] };
  };
  deps.safeErrMessage = (e) => String(e?.message || e);
  deps.stateFindUserRecord = () => null;

  const decideExtras = {};
  await onboarding.afterDecide({
    req: { user: { tenant_id: 'tenant-b' } },
    deps,
    updated: {
      id: 'onb-oid',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '飞书入职', feishuOpenId: 'oid-abc' } },
    },
    username: 'a1',
    decideExtras,
  });
  assert.equal(decideExtras.userAccountCreated, true);
  assert.equal(decideExtras.feishuUsersCreated, true);
  assert.equal(timeline[0]?.tenantId, 'tenant-b');
  assert.equal(timeline[0]?.effectiveFrom, '2026-08-01');
  assert.ok(queries.some((q) => /feishu_users/i.test(String(q[0]))));
  const recipients = (merges.find((m) => Array.isArray(m.patch.notifications))?.patch.notifications || [])
    .map((x) => x.u);
  assert.ok(recipients.includes('hr1'));
  assert.equal(recipients.includes('cook1'), false);

  const { deps: d2, notifs: n2 } = makeDeps();
  d2.stateFindUserRecord = () => null;
  await onboarding.afterDecide({
    req: {},
    deps: d2,
    updated: {
      id: 'onb-empty-name',
      type: 'onboarding',
      status: 'rejected',
      applicant_username: 'hr2',
      payload: { employee: {} },
    },
    note: '资料不全',
    decideExtras: {},
  });
  assert.ok(n2.some((x) => x.title === '新员工入职审批被拒绝' && /新员工「新员工」/.test(x.msg) && /资料不全/.test(x.msg)));

  const { deps: d3, notifs: n3 } = makeDeps();
  d3.getSharedState = async () => ({ employees: null });
  d3.stateFindUserRecord = () => null;
  await onboarding.afterDecide({
    req: {},
    deps: d3,
    updated: {
      id: 'onb-pend-anon',
      type: 'onboarding',
      status: 'pending',
      applicant_username: 'hr3',
      payload: { employee: 'bad' },
    },
    nextAssignee: 'mgr9',
    decideExtras: {},
  });
  assert.ok(n3.some((x) => x.title === '新员工入职审批待处理' && /「新员工」/.test(x.msg)));

  await onboarding.afterDecide({
    req: {},
    deps: d3,
    updated: null,
    decideExtras: {},
  });
  await onboarding.afterDecide({
    req: {},
    deps: d3,
    updated: { id: 'x', type: 'points', status: 'approved', payload: {} },
    decideExtras: {},
  });
});

test('leave.afterDecide：finishDate/leaveDays 别名；tenant 回落 user；leaveRecords 非数组', async () => {
  const { deps, notifs, queries, dualWriteFails } = makeDeps({
    state: { leaveRecords: null },
  });
  deps.stateFindUserRecord = () => ({
    username: 'emp1',
    name: '',
    managerUsername: '',
    store: '',
    brand: '',
    department: '',
    position: '',
  });
  deps.calcDateSpanDaysInclusive = () => null;
  deps.pool.query = async (...a) => {
    queries.push(a);
    throw new Error('leave dw boom');
  };

  await leave.afterDecide({
    req: { user: { tenant_id: 't-leave' } },
    deps,
    username: 'approver1',
    updated: {
      id: 'lv-alias',
      type: 'leave',
      status: 'approved',
      applicant_username: 'emp1',
      payload: {
        beginDate: '2026-08-10',
        finishDate: '2026-08-12',
        leaveDays: 3,
        leaveReason: '事假',
        type: 'personal',
      },
    },
  });
  assert.equal(dualWriteFails.length, 1);
  assert.equal(queries.length, 1);
  assert.equal(queries[0][1][7], 3);
  assert.equal(queries[0][1][14], 't-leave');
  assert.ok(notifs.some((n) => n.title === '休假申请已通过'));
});

test('onboarding.afterDecide：bcrypt.hash 失败仍写飞书并通知', async () => {
  const queries = [];
  const { deps, merges } = makeDeps();
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'newbcrypt',
      name: '哈希失败',
      role: 'store_employee',
      department: '',
      position: '',
      store: '甲店',
      managerUsername: 'mgr1',
      salary: 0,
    },
    newUsername: 'newbcrypt',
    empName: '哈希失败',
    empPassword: 'Temp1234',
  });
  deps.bcrypt = {
    hash: async () => {
      throw new Error('bcrypt boom');
    },
  };
  deps.toNullableUuid = (v) => (v ? String(v) : null);
  deps.insertSalaryTimeline = async () => {};
  deps.safeErrMessage = (e) => String(e?.message || e);
  deps.pool.query = async (...a) => {
    queries.push(a);
    return { rows: [] };
  };

  const decideExtras = {};
  await onboarding.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'onb-bcrypt',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '哈希失败', open_id: 'oid-hash' } },
    },
    username: 'a1',
    decideExtras,
  });
  assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
  assert.equal(decideExtras.userAccountCreated, undefined);
  assert.equal(decideExtras.feishuUsersCreated, true);
  assert.ok(queries.some((q) => /feishu_users/i.test(String(q[0]))));
  assert.ok(merges.some((m) => Array.isArray(m.patch.notifications)));
});

test('points.afterDecide：单条 items 用 reason 作文案；merge 失败则无双写/通知', async () => {
  {
    const { deps, notifs, ledgerCalls } = makeDeps();
    await points.afterDecide({
      req: { tenantId: 'default', user: { username: 'a1' } },
      deps,
      updated: {
        id: 'pts-one-reason',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: {
          store: '测试店',
          items: [{ points: 5, reason: '门店巡检加分' }],
        },
      },
    });
    assert.equal(ledgerCalls.length, 1);
    assert.equal(ledgerCalls[0][0].title, '门店巡检加分');
    assert.ok(notifs.some((n) => n.title === '积分申请已通过' && /门店巡检加分/.test(n.msg)));
  }
  {
    const { deps, notifs, ledgerCalls, queries, dualWriteFails } = makeDeps();
    deps.mergeSharedStateFields = async () => {
      throw new Error('merge points boom');
    };
    await points.afterDecide({
      req: { tenantId: 'default', user: { username: 'a1' } },
      deps,
      updated: {
        id: 'pts-merge-fail',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { points: 2, itemName: '失败项', store: '测试店' },
      },
    });
    assert.equal(ledgerCalls.length, 1);
    assert.equal(queries.length, 0);
    assert.equal(dualWriteFails.length, 0);
    assert.equal(notifs.length, 0);
  }
});

test('promotion.beforeUpdate：拒绝可不指定带教；培训字段截断到30天', async () => {
  {
    const res = makeRes();
    const queries = [];
    const updatedPayload = { promotionStage: 'qualification' };
    const out = await promotion.beforeUpdate({
      res,
      row: { type: 'promotion' },
      role: 'store_manager',
      username: 'mgr1',
      nowIso: '2026-07-26T12:00:00+08:00',
      approved: false,
      mentorUsernameRaw: '',
      updatedPayload,
      deps: makePromotionDeps(async (...a) => {
        queries.push(a);
        return { rows: [] };
      }),
    });
    assert.equal(out?.abort, undefined);
    assert.equal(res.statusCode, null);
    assert.equal(queries.length, 0);
  }
  {
    const res = makeRes();
    const updatedPayload = { promotionStage: 'qualification' };
    await promotion.beforeUpdate({
      res,
      row: { type: 'promotion' },
      role: 'store_manager',
      username: 'mgr1',
      nowIso: '2026-07-26T12:00:00+08:00',
      approved: true,
      mentorUsernameRaw: 'mentor1',
      mentorNameRaw: '带教',
      trainingStartDateRaw: '2026-08-01',
      trainingDaysRaw: 45,
      trainingPeriodsRaw: [{ startDate: '2026-08-01', endDate: '2026-08-10' }],
      updatedPayload,
      deps: {
        ...makePromotionDeps(async () => ({ rows: [{ ok: 1 }] })),
        normalizePromotionTrainingPeriods: (p) => (Array.isArray(p) ? p : []),
        safeDateOnly: (d) => String(d || '').slice(0, 10) || '',
      },
    });
    assert.equal(updatedPayload.trainingStartDate, '2026-08-01');
    assert.equal(updatedPayload.trainingDays, 30);
    assert.equal(updatedPayload.trainingPeriods.length, 1);
  }
});

test('promotion.afterDecide：无必修课题跳过培训；拒绝无 trackId；skill_bump 空课题', async () => {
  const progressCalls = [];
  const trainings = [];
  const { deps, merges, notifs } = makeDeps({
    state: {
      employees: [{
        username: 'emp1',
        name: '员工',
        level: '初级',
        position: '服务员',
        salary: 4000,
        store: '测试店',
        department: '前厅',
        promotionHistory: [],
      }],
      promotionTracks: [],
    },
  });
  deps.findUserSalary = () => 4000;
  deps.insertSalaryTimeline = async () => {};
  deps.applyPromotionSalaryNextMonth = async () => {};
  deps.getPromotionRequiredTopics = async () => [];
  deps.getPromotionTrackProgress = async (...a) => {
    progressCalls.push(a);
    return { items: [] };
  };
  deps.createTrainingAssignment = async (a) => {
    trainings.push(a);
  };
  deps.normalizePromotionTrainingPeriods = () => [];
  deps.isKitchenByRoleOrPosition = () => false;
  deps.pickHqManagerUsername = async () => '';
  deps.pickStoreRoleUsernameByStore = () => '';

  await promotion.afterDecide({
    req: { tenantId: 'default' },
    deps,
    username: 'approver1',
    updated: {
      id: 'ap-no-topics',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'emp1',
      chain: [],
      payload: {
        promotionStage: 'formal',
        promoTier: 'level_promotion',
        newLevel: '中级',
        newPosition: '领班',
        promotedSalary: 5000,
      },
    },
  });
  assert.equal(progressCalls.length, 0);
  assert.equal(trainings.length, 0);
  assert.ok(merges.some((m) => m.patch.employees?.[0]?.level === '中级'));
  assert.ok(notifs.length === 0 || merges.some((m) => Array.isArray(m.patch.notifications)));

  const getCalls = [];
  const rej = makeDeps({
    state: { employees: [{ username: 'emp1', name: '员工', store: '测试店', managerUsername: 'mgr1' }] },
  });
  rej.deps.findUserSalary = () => null;
  rej.deps.insertSalaryTimeline = async () => {};
  rej.deps.applyPromotionSalaryNextMonth = async () => {};
  rej.deps.getPromotionRequiredTopics = async () => [];
  rej.deps.getPromotionTrackProgress = async () => ({ items: [] });
  rej.deps.createTrainingAssignment = async () => {};
  rej.deps.normalizePromotionTrainingPeriods = () => [];
  rej.deps.isKitchenByRoleOrPosition = () => false;
  rej.deps.pickHqManagerUsername = async () => '';
  rej.deps.pickStoreRoleUsernameByStore = () => '';
  const origGet = rej.deps.getSharedState;
  rej.deps.getSharedState = async () => {
    getCalls.push(1);
    return origGet();
  };
  await promotion.afterDecide({
    req: { tenantId: 'default' },
    deps: rej.deps,
    username: 'approver1',
    note: '暂缓',
    updated: {
      id: 'ap-rej-no-track',
      type: 'promotion',
      status: 'rejected',
      applicant_username: 'emp1',
      payload: { promotionStage: 'formal' },
    },
  });
  assert.ok(rej.notifs.some((n) => n.title === '晋升申请未通过'));
  assert.equal(getCalls.length, 1);

  const skill = makeDeps({
    state: {
      employees: [{ username: 'emp1', name: '员工', store: '测试店', role: 'store_employee' }],
      promotionTracks: [],
    },
  });
  skill.deps.findUserSalary = () => null;
  skill.deps.insertSalaryTimeline = async () => {};
  skill.deps.applyPromotionSalaryNextMonth = async () => {};
  skill.deps.getPromotionRequiredTopics = async () => [{ id: 99 }];
  skill.deps.getPromotionTrackProgress = async () => ({ items: [] });
  skill.deps.createTrainingAssignment = async (a) => {
    trainings.push(a);
  };
  skill.deps.normalizePromotionTrainingPeriods = () => [];
  skill.deps.isKitchenByRoleOrPosition = () => false;
  skill.deps.pickHqManagerUsername = async () => '';
  skill.deps.pickStoreRoleUsernameByStore = () => 'sm1';
  skill.deps.pool.query = async () => ({ rows: [] });
  const beforeTrain = trainings.length;
  await promotion.afterDecide({
    req: { tenantId: 'default' },
    deps: skill.deps,
    username: 'approver1',
    updated: {
      id: 'ap-skill-empty',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'emp1',
      payload: {
        promotionStage: 'qualification',
        promoTier: 'skill_bump',
        selectedTopicIds: [11, 12],
        targetPosition: '领班',
        mentorUsername: 'mentor1',
      },
    },
  });
  assert.equal(trainings.length, beforeTrain);
  assert.ok(skill.merges.some((m) => Array.isArray(m.patch.promotionTracks)));
  assert.equal(skill.notifs.some((n) => n.title === '晋升培训任务已生成'), false);
});

test('points.afterDecide：rate=0 合法；offboarding 立即关登录并打 users；promotion pending 带教提示', async () => {
  {
    const { deps, ledgerCalls, notifs } = makeDeps({
      depsExtra: {
        resolveAttendancePayrollRules: async () => ({ rules: { pointsYuanPerPoint: 0 } }),
      },
    });
    await points.afterDecide({
      req: { tenantId: 'default', user: { username: 'a1' } },
      deps,
      updated: {
        id: 'pts-zero-rate',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { points: 10, itemName: '零折算', store: '测试店' },
      },
    });
    assert.equal(ledgerCalls[0][0].amount, 0);
    assert.ok(notifs.some((n) => /¥0\.00/.test(n.msg)));
  }

  {
    const { deps, notifs, merges } = makeDeps({
      state: {
        employees: [{ username: 'emp1', name: '员工甲', store: '测试店', status: 'active' }],
        users: [{ username: 'emp1', status: 'active' }],
      },
    });
    deps.stateFindUserRecord = () => ({
      username: 'emp1',
      name: '员工甲',
      managerUsername: 'mgr1',
      store: '测试店',
    });
    deps.shanghaiTodayDateOnly = () => '2026-07-26';
    deps.safeDateOnly = (d) => String(d || '').slice(0, 10) || '';
    await offboarding.afterDecide({
      req: {},
      deps,
      updated: {
        id: 'ob-now',
        type: 'offboarding',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { resignationDate: '2026-07-20' },
      },
    });
    assert.ok(notifs.some((n) => n.title === '离职申请已通过' && /已关闭 HRMS 登录/.test(n.msg)));
    assert.ok(merges.some((m) => m.patch.employees?.[0]?.status === '离职'));
    assert.ok(merges.some((m) => m.patch.users?.[0]?.status === '离职'));
  }

  {
    const { deps, notifs } = makeDeps();
    deps.stateFindUserRecord = (_s, u) => {
      if (u === 'sm1') return { username: 'sm1', role: 'store_manager', name: '店长' };
      return { username: u, name: '申请人', managerUsername: 'mgr1' };
    };
    deps.findUserSalary = () => null;
    deps.insertSalaryTimeline = async () => {};
    deps.applyPromotionSalaryNextMonth = async () => {};
    deps.getPromotionRequiredTopics = async () => [];
    deps.getPromotionTrackProgress = async () => ({ items: [] });
    deps.createTrainingAssignment = async () => {};
    deps.normalizePromotionTrainingPeriods = () => [];
    deps.isKitchenByRoleOrPosition = () => false;
    deps.pickHqManagerUsername = async () => '';
    deps.pickStoreRoleUsernameByStore = () => '';
    await promotion.afterDecide({
      req: { tenantId: 'default' },
      deps,
      username: 'a1',
      nextAssignee: 'sm1',
      updated: {
        id: 'ap-pend-tip',
        type: 'promotion',
        status: 'pending',
        applicant_username: 'emp1',
        payload: { promotionStage: 'qualification' },
      },
    });
    assert.ok(notifs.some((n) => n.title === '晋升申请待审批' && /带教人/.test(n.msg)));
  }
});

test('leave.beforeUpdate：非有限 remainingLeaveDays 不写；onboarding openId 别名', async () => {
  const updatedPayload = {};
  await leave.beforeUpdate({
    row: { type: 'leave' },
    remainingLeaveDaysRaw: 'NaN',
    username: 'mgr1',
    updatedPayload,
  });
  assert.equal(updatedPayload.remainingLeaveDays, undefined);

  const queries = [];
  const { deps } = makeDeps();
  deps.buildOnboardingEmployeeRecordFromPayload = () => ({
    ok: true,
    nextEmp: {
      username: 'newoid2',
      name: '别名',
      role: 'store_employee',
      department: '',
      position: '',
      store: '',
      managerUsername: '',
      salary: 0,
    },
    newUsername: 'newoid2',
    empName: '别名',
    empPassword: 'Temp',
  });
  deps.bcrypt = { hash: async () => 'h' };
  deps.toNullableUuid = (v) => (String(v || '').includes('open') ? 'uuid-open' : null);
  deps.insertSalaryTimeline = async () => {};
  deps.pool.query = async (...a) => {
    queries.push(a);
    return { rows: [] };
  };
  const decideExtras = {};
  await onboarding.afterDecide({
    req: { tenantId: 'default' },
    deps,
    updated: {
      id: 'onb-openid',
      type: 'onboarding',
      status: 'approved',
      applicant_username: 'hr1',
      payload: { employee: { name: '别名', openId: 'openid-x' } },
    },
    username: 'a1',
    decideExtras,
  });
  assert.equal(decideExtras.feishuUsersCreated, true);
  assert.ok(queries.some((q) => /feishu_users/i.test(String(q[0]))));
});

test('monthly_confirm：payload JSON 字符串；confirmation 缺失仍通知；外层 catch 吞错', async () => {
  const { deps, notifs, merges } = makeDeps({
    state: { monthlyConfirmations: [] },
  });
  await monthlyConfirm.afterDecide({
    req: { user: { username: 'approver1' } },
    deps,
    updated: {
      id: 'mc-json',
      type: 'monthly_confirm',
      status: 'approved',
      applicant_username: 'emp1',
      payload: JSON.stringify({ confirmationId: 'missing-id', month: '2026-07', store: '甲店' }),
    },
  });
  assert.equal(merges.length, 0);
  assert.ok(notifs.some((n) => n.title === '月度考勤确认已通过' && /甲店/.test(n.msg)));

  const boom = makeDeps();
  boom.deps.getSharedState = async () => {
    throw new Error('state boom');
  };
  await monthlyConfirm.afterDecide({
    req: {},
    deps: boom.deps,
    updated: {
      id: 'mc-boom',
      type: 'monthly_confirm',
      status: 'pending',
      applicant_username: 'emp1',
      payload: { confirmationId: 'x', month: '2026-07' },
    },
    nextAssignee: 'mgr1',
  });
  assert.equal(boom.notifs.length, 0);
});

test('leave pending；offboarding pending 写通知；promotion 资格拒绝文案', async () => {
  {
    const { deps, notifs } = makeDeps();
    await leave.afterDecide({
      req: {},
      deps,
      nextAssignee: 'mgr1',
      updated: {
        id: 'lv-pend',
        type: 'leave',
        status: 'pending',
        applicant_username: 'emp1',
        payload: { startDate: '2026-08-01', endDate: '2026-08-02' },
      },
    });
    assert.ok(notifs.some((n) => n.title === '休假申请待审批'));
  }
  {
    const { deps, merges } = makeDeps();
    await offboarding.afterDecide({
      req: {},
      deps,
      nextAssignee: 'hr1',
      updated: {
        id: 'ob-pend',
        type: 'offboarding',
        status: 'pending',
        applicant_username: 'emp1',
        payload: {},
      },
    });
    assert.ok(merges.some((m) =>
      Array.isArray(m.patch.notifications)
      && m.patch.notifications.some((n) => n.title === '离职申请待审批')));
  }
  {
    const { deps, notifs } = makeDeps();
    deps.findUserSalary = () => null;
    deps.insertSalaryTimeline = async () => {};
    deps.applyPromotionSalaryNextMonth = async () => {};
    deps.getPromotionRequiredTopics = async () => [];
    deps.getPromotionTrackProgress = async () => ({ items: [] });
    deps.createTrainingAssignment = async () => {};
    deps.normalizePromotionTrainingPeriods = () => [];
    deps.isKitchenByRoleOrPosition = () => false;
    deps.pickHqManagerUsername = async () => '';
    deps.pickStoreRoleUsernameByStore = () => '';
    await promotion.afterDecide({
      req: { tenantId: 'default' },
      deps,
      username: 'a1',
      note: '',
      updated: {
        id: 'ap-qual-rej',
        type: 'promotion',
        status: 'rejected',
        applicant_username: 'emp1',
        payload: { promotionStage: 'qualification' },
      },
    });
    assert.ok(notifs.some((n) => n.title === '晋升申请未通过' && /晋升资格/.test(n.msg) && /相关原因/.test(n.msg)));
  }
});

test('promotion.afterDecide：formal 有 chain/课题；qualification 厨房+周期培训', async () => {
  const trainings = [];
  const timeline = [];
  const { deps, merges, notifs } = makeDeps({
    state: {
      employees: [{
        username: 'emp1',
        name: '员工',
        level: '初级',
        position: '服务员',
        salary: 4500,
        store: '测试店',
        department: '前厅',
        joinDate: '2025-01-01',
        promotionHistory: [],
        managerUsername: 'mgr1',
      }],
      promotionTracks: [{ id: 'trk-1', status: 'qualification_approved' }],
      salaryChangeHistory: [{ id: 'old' }],
    },
  });
  deps.findUserSalary = () => 4500;
  deps.insertSalaryTimeline = async (a) => { timeline.push(a); };
  deps.applyPromotionSalaryNextMonth = async () => {};
  deps.getPromotionRequiredTopics = async () => [
    { id: 1, title: '已认证课' },
    { id: 2, title: '待训课' },
  ];
  deps.getPromotionTrackProgress = async () => ({
    items: [
      { topicId: 1, certified: true },
      { topicId: 2, certified: false },
    ],
  });
  deps.createTrainingAssignment = async (a) => { trainings.push(a); };
  deps.normalizePromotionTrainingPeriods = () => [];
  deps.isKitchenByRoleOrPosition = () => false;
  deps.pickHqManagerUsername = async () => '';
  deps.pickStoreRoleUsernameByStore = () => '';

  await promotion.afterDecide({
    req: { tenantId: 'default', user: { username: 'approver1' } },
    deps,
    username: 'approver1',
    updated: {
      id: 'ap-formal-chain',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'emp1',
      chain: [
        { step: 1, assignee: 'sm1', status: 'approved', decidedAt: '2026-07-01' },
        { step: null, assignee: '', status: '', decidedAt: '' },
      ],
      payload: {
        promotionStage: 'formal',
        promoTier: 'level_promotion',
        newLevel: '中级',
        newPosition: '领班',
        promotedSalary: 5500,
        promotionTrackId: 'trk-1',
        reason: '表现优秀',
      },
    },
  });
  assert.equal(timeline.some((t) => t.source === 'profile_baseline'), true);
  assert.equal(trainings.length, 1);
  assert.equal(trainings[0].topicId, 2);
  assert.ok(merges.some((m) =>
    Array.isArray(m.patch.salaryChangeHistory)
    && m.patch.salaryChangeHistory[0]?.chain?.length === 2
    && m.patch.salaryChangeHistory[0].chain[0].assignee === 'sm1'));
  assert.ok(merges.some((m) => m.patch.promotionTracks?.[0]?.status === 'promoted'));

  const qTrain = [];
  const q = makeDeps({
    state: {
      employees: [{
        username: 'cook1',
        name: '厨工',
        role: 'kitchen_staff',
        position: '厨师',
        department: '后厨',
        store: '测试店',
      }],
      promotionTracks: [],
    },
  });
  q.deps.findUserSalary = () => null;
  q.deps.insertSalaryTimeline = async () => {};
  q.deps.applyPromotionSalaryNextMonth = async () => {};
  q.deps.getPromotionRequiredTopics = async () => [{ id: 9, title: '刀工' }];
  q.deps.getPromotionTrackProgress = async () => ({ items: [] });
  q.deps.createTrainingAssignment = async (a) => { qTrain.push(a); };
  q.deps.normalizePromotionTrainingPeriods = () => [
    { startDate: '2026-08-01', endDate: '2026-08-15' },
  ];
  q.deps.isKitchenByRoleOrPosition = () => true;
  q.deps.pickHqManagerUsername = async () => 'hq1';
  q.deps.pickStoreRoleUsernameByStore = (_s, _store, roles) =>
    (roles.includes('store_production_manager') ? 'pm1' : 'sm1');

  await promotion.afterDecide({
    req: { tenantId: 'default' },
    deps: q.deps,
    username: 'approver1',
    updated: {
      id: 'ap-qual-kitchen',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'cook1',
      payload: {
        promotionStage: 'qualification',
        promoTier: 'level_promotion',
        targetPosition: '主厨',
        targetLevel: '中级',
        mentorUsername: 'mentor1',
        mentorName: '带教甲',
        trainingStartDate: '2026-08-01',
        trainingDays: 3,
        trainingPeriods: [{ startDate: '2026-08-01', endDate: '2026-08-15' }],
      },
    },
  });
  assert.equal(qTrain.length, 1);
  assert.equal(qTrain[0].dueDate, '2026-08-15');
  assert.ok(q.notifs.some((n) => n.title === '晋升资格申请已批准' && n.u === 'pm1'));
  assert.ok(q.notifs.some((n) => n.title === '晋升培训任务已生成'));
  assert.ok(q.merges.some((m) => m.patch.promotionTracks?.[0]?.trainingDueDate === '2026-08-15'));
  void notifs;
});

test('leave/points/onboarding：无日期天数空串；规则抛错；open_id/空店长名', async () => {
  {
    const queries = [];
    const { deps, notifs } = makeDeps({
      state: { leaveRecords: null },
    });
    deps.stateFindUserRecord = () => ({ username: '', store: '', brand: '', department: '', position: '' });
    deps.calcDateSpanDaysInclusive = () => null;
    deps.safeNumber = () => null;
    deps.pool.query = async (...a) => {
      queries.push(a);
      return { rows: [] };
    };
    await leave.afterDecide({
      req: { user: { tenant_id: 'from-user' } },
      deps,
      username: 'approver1',
      updated: {
        id: 'lv-empty-days',
        type: 'leave',
        status: 'approved',
        applicant_username: 'ghost',
        payload: { type: 'sick', reason: '感冒' },
      },
    });
    assert.ok(notifs.some((n) => n.title === '休假申请已通过'));
    const ins = queries.find((q) => /INSERT INTO hrms_leave_records/i.test(String(q[0])));
    assert.ok(ins);
    assert.equal(ins[1][7], 0);
    assert.equal(ins[1][8], 'sick');
    assert.equal(ins[1][14], 'from-user');
  }
  {
    const { deps, notifs, ledgerCalls } = makeDeps({
      state: {},
      depsExtra: {
        resolveAttendancePayrollRules: async () => {
          throw new Error('rules down');
        },
      },
    });
    deps.stateFindUserRecord = () => ({
      username: 'emp1',
      name: '甲',
      store: '乙店',
      managerUsername: 'mgr1',
    });
    await points.afterDecide({
      req: { user: { username: 'approver1', tenant_id: 't-pts' } },
      deps,
      updated: {
        id: '',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: {
          points: 3,
          businessMonth: '2026-06',
          itemName: '加分',
        },
        created_at: 'bad',
      },
    });
    assert.equal(ledgerCalls[0][0].amount, 1.5);
    assert.equal(ledgerCalls[0][0].bizMonth, '2026-06');
    assert.equal(ledgerCalls[0][0].store, '乙店');
    assert.ok(notifs.some((n) => n.title === '积分申请已通过' && /¥1\.50/.test(n.msg)));
  }
  {
    const { deps, notifs } = makeDeps({ state: {} });
    deps.getSharedState = async () => {
      throw new Error('state boom');
    };
    await points.afterDecide({
      req: {},
      deps,
      updated: { id: 'p1', type: 'points', status: 'rejected', applicant_username: 'emp1', payload: {} },
      note: '',
    });
    assert.equal(notifs.length, 0);
  }
  {
    const queries = [];
    const { deps, merges } = makeDeps({
      state: {
        employees: [
          { username: '', store: '甲店', role: 'store_manager', name: '空名店长' },
        ],
      },
    });
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: true,
      nextEmp: {
        username: 'newoid3',
        name: '新员工丙',
        role: 'store_employee',
        store: '甲店',
        department: '',
        position: '',
        salary: 0,
        joinDate: '',
        managerUsername: 'mgrX',
      },
      newUsername: 'newoid3',
      empName: '新员工丙',
      empPassword: 'pwd',
    });
    deps.bcrypt = { hash: async () => 'hash' };
    deps.toNullableUuid = (v) => (v === 'uuid-open' ? 'uuid-open' : null);
    deps.insertSalaryTimeline = async () => {
      throw new Error('should not run for salary 0');
    };
    deps.pool.query = async (...a) => {
      queries.push(a);
      return { rows: [] };
    };
    const decideExtras = {};
    await onboarding.afterDecide({
      req: { user: { tenant_id: 't-onb' } },
      deps,
      username: 'hr1',
      decideExtras,
      updated: {
        id: 'onb-open-id',
        type: 'onboarding',
        status: 'approved',
        applicant_username: 'hr1',
        payload: { employee: { name: '新员工丙', open_id: 'uuid-open' } },
      },
    });
    assert.equal(decideExtras.feishuUsersCreated, true);
    assert.ok(queries.some((q) => /feishu_users/i.test(String(q[0])) && q[1].includes('uuid-open')));
    assert.ok(merges.some((m) =>
      Array.isArray(m.patch.notifications)
      && m.patch.notifications.some((n) => n.u === 'mgrX')));
  }
  {
    const { deps, notifs } = makeDeps();
    await onboarding.afterDecide({
      req: {},
      deps,
      note: '资料不全',
      updated: {
        id: 'onb-rej-note',
        type: 'onboarding',
        status: 'rejected',
        applicant_username: 'hr1',
        payload: { employee: { name: '丁' } },
      },
    });
    assert.ok(notifs.some((n) => n.title === '新员工入职审批被拒绝' && /资料不全/.test(n.msg)));
  }
});

test('points/onboarding/leave：occurMonth；feishuOpenId；拒绝无 note；申请人无名', async () => {
  {
    const { deps, ledgerCalls, notifs } = makeDeps({
      state: { pointsAppliedApprovals: {} },
      depsExtra: {
        resolveAttendancePayrollRules: async () => ({ rules: { pointsYuanPerPoint: Number.NaN } }),
      },
    });
    deps.stateFindUserRecord = () => ({ username: 'emp1', name: '', store: '丙店' });
    await points.afterDecide({
      req: { tenantId: 't1', user: { username: 'a1' } },
      deps,
      updated: {
        id: 'pts-occur',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: {
          occurMonth: '2026-05',
          items: [
            { points: 2, reason: 'A', bizMonth: '2026-05', username: 'emp2', name: '乙' },
            { points: 1, itemName: 'B', occurDate: '2026-05-20' },
          ],
        },
      },
    });
    assert.equal(ledgerCalls.length, 2);
    assert.equal(ledgerCalls[0][0].bizMonth, '2026-05');
    assert.equal(ledgerCalls[1][0].bizMonth, '2026-05');
    assert.ok(notifs.some((n) => /2条积分事项/.test(n.msg) && n.u === 'emp1'));
  }
  {
    const { deps, notifs } = makeDeps();
    deps.stateFindUserRecord = () => null;
    await points.afterDecide({
      req: {},
      deps,
      note: '',
      updated: {
        id: 'pts-rej',
        type: 'points',
        status: 'rejected',
        applicant_username: 'nobody',
        payload: { points: 1 },
      },
    });
    assert.ok(notifs.some((n) => n.title === '积分申请未通过' && /相关原因/.test(n.msg) && n.u === 'nobody'));
  }
  {
    const queries = [];
    const { deps } = makeDeps({ state: { employees: [] } });
    const decideExtras = {};
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: true,
      nextEmp: {
        username: 'newf',
        name: '飞书名',
        role: 'store_employee',
        store: '',
        department: '',
        position: '',
        salary: 'abc',
        joinDate: 'bad',
        managerUsername: '',
      },
      newUsername: 'newf',
      empName: '飞书名',
      empPassword: 'p',
    });
    deps.bcrypt = { hash: async () => 'h' };
    deps.toNullableUuid = (v) => (String(v) === 'feishu-uuid' ? 'feishu-uuid' : null);
    deps.safeDateOnly = () => '';
    deps.insertSalaryTimeline = async () => {
      throw new Error('no salary');
    };
    deps.pool.query = async (...a) => {
      queries.push(a);
      return { rows: [] };
    };
    await onboarding.afterDecide({
      req: { tenantId: 'default' },
      deps,
      username: 'hr1',
      decideExtras,
      updated: {
        id: 'onb-feishu-alias',
        type: 'onboarding',
        status: 'approved',
        applicant_username: '',
        payload: { employee: { name: '飞书名', feishuOpenId: 'feishu-uuid' } },
      },
    });
    assert.equal(decideExtras.feishuUsersCreated, true);
    assert.ok(queries.some((q) => /feishu_users/i.test(String(q[0]))));
  }
  {
    const { deps, notifs } = makeDeps();
    deps.stateFindUserRecord = () => ({ username: 'emp1' });
    await leave.afterDecide({
      req: { tenantId: 'default' },
      deps,
      note: '',
      username: 'a1',
      updated: {
        id: 'lv-rej-nonote',
        type: 'leave',
        status: 'rejected',
        applicant_username: 'emp1',
        payload: { fromDate: '2026-08-01', toDate: '2026-08-02' },
      },
    });
    assert.ok(notifs.some((n) => n.title === '休假申请未通过' && /相关原因/.test(n.msg)));
  }
});

test('leave/points/promotion：reqDays=0 走 auto；alreadyApplied；formal skill_bump', async () => {
  {
    const { deps, notifs, queries } = makeDeps();
    deps.safeNumber = (n) => {
      const x = Number(n);
      return Number.isFinite(x) ? x : null;
    };
    deps.calcDateSpanDaysInclusive = () => 4;
    deps.stateFindUserRecord = () => ({
      username: 'emp1',
      name: '',
      managerUsername: '',
      store: '甲',
      brand: '洪潮',
    });
    deps.pool.query = async (...a) => {
      queries.push(a);
      return { rows: [] };
    };
    await leave.afterDecide({
      req: {},
      deps,
      username: 'a1',
      note: '人手不足',
      updated: {
        id: 'lv-zero-days',
        type: 'leave',
        status: 'approved',
        applicant_username: 'emp1',
        payload: {
          days: 0,
          leaveDays: 0,
          leaveReason: '事假',
          startDate: '2026-10-01',
          endDate: '2026-10-04',
          type: '',
        },
      },
    });
    const ins = queries.find((q) => /INSERT INTO hrms_leave_records/i.test(String(q[0])));
    assert.equal(ins[1][7], 4);
    assert.equal(ins[1][8], 'leave');
    assert.ok(notifs.some((n) => n.title === '休假申请已通过' && n.u === 'emp1'));

    const rej = makeDeps();
    rej.deps.stateFindUserRecord = () => null;
    await leave.afterDecide({
      req: { tenantId: 'default' },
      deps: rej.deps,
      username: 'a1',
      note: '冲突',
      updated: {
        id: 'lv-rej-note2',
        type: 'leave',
        status: 'rejected',
        applicant_username: 'ghost',
        payload: { fromDate: '2026-10-01', toDate: '2026-10-02' },
      },
    });
    assert.ok(rej.notifs.some((n) => /因为冲突/.test(n.msg)));
  }
  {
    const { deps, notifs, ledgerCalls, merges } = makeDeps({
      state: { pointsAppliedApprovals: { 'pts-done': true }, pointRecords: [] },
    });
    deps.stateFindUserRecord = () => ({ username: 'emp1', name: '甲', managerUsername: 'mgr1', store: '店' });
    await points.afterDecide({
      req: { user: { username: 'a1' } },
      deps,
      updated: {
        id: 'pts-done',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { points: 5, eventDate: '2026-04-15', itemName: '' },
        updated_at: '2026-04-01T00:00:00Z',
      },
    });
    assert.equal(ledgerCalls.length, 0);
    assert.equal(merges.length, 0);
    assert.ok(notifs.some((n) => n.title === '积分申请已通过' && /5积分/.test(n.msg) && /2026-04/.test(n.msg)));
  }
  {
    const trainings = [];
    const { deps, merges } = makeDeps({
      state: {
        employees: [{
          username: 'emp1',
          name: '技师',
          level: '中级',
          position: '技师',
          salary: 5000,
          store: '测试店',
          department: '前厅',
          promotionHistory: [],
        }],
        promotionTracks: [{ id: 'trk-skill', status: 'qualification_approved' }],
      },
    });
    deps.findUserSalary = () => 5000;
    deps.insertSalaryTimeline = async () => {};
    deps.applyPromotionSalaryNextMonth = async () => {};
    deps.getPromotionRequiredTopics = async () => [{ id: 3, title: '技能课' }];
    deps.getPromotionTrackProgress = async () => ({ items: [{ topicId: 3, certified: false }] });
    deps.createTrainingAssignment = async (a) => { trainings.push(a); };
    deps.normalizePromotionTrainingPeriods = () => [];
    deps.isKitchenByRoleOrPosition = () => false;
    deps.pickHqManagerUsername = async () => '';
    deps.pickStoreRoleUsernameByStore = () => '';
    await promotion.afterDecide({
      req: { tenantId: 'default' },
      deps,
      username: 'approver1',
      updated: {
        id: 'ap-skill-formal',
        type: 'promotion',
        status: 'approved',
        applicant_username: 'emp1',
        chain: null,
        payload: {
          promotionStage: 'formal',
          promoTier: 'skill_bump',
          level: '高级',
          position: '高级技师',
          promotedSalary: 6000,
          promotionTrackId: 'trk-skill',
          store: '测试店',
        },
      },
    });
    const emp = merges.find((m) => m.patch.employees)?.patch.employees[0];
    assert.equal(emp?.level, '中级', 'skill_bump 不改职级');
    assert.equal(emp?.position, '技师', 'skill_bump 不改岗位');
    assert.equal(emp?.salary, 6000);
    assert.equal(trainings.length, 0, 'formal skill_bump 不按新岗位下发培训');
    assert.ok(merges.some((m) => m.patch.salaryChangeHistory?.[0]?.chain?.length === 0));
    assert.ok(merges.some((m) => m.patch.promotionTracks?.[0]?.status === 'promoted'));
  }
});

test('onboarding：空员工名失败日志；仅提交人通知；pending 默认新员工；外层吞错', async () => {
  {
    const decideExtras = {};
    const { deps } = makeDeps({ state: {} });
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: false,
      reason: 'missing_name',
    });
    await onboarding.afterDecide({
      req: {},
      deps,
      decideExtras,
      updated: {
        id: 'onb-noname',
        type: 'onboarding',
        status: 'approved',
        applicant_username: 'hr1',
        payload: { employee: {} },
      },
      username: 'a1',
    });
    assert.equal(decideExtras.onboardingEmployeeSync?.ok, false);
    assert.equal(decideExtras.onboardingEmployeeSync?.reason, 'missing_name');
  }
  {
    const { deps, merges } = makeDeps({
      state: { employees: 'bad' },
    });
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: true,
      nextEmp: {
        username: 'solo1',
        name: '独行',
        role: 'store_employee',
        store: '幽灵店',
        department: 'd',
        position: 'p',
        salary: 3000,
        joinDate: '2026-07-01',
        managerUsername: '',
      },
      newUsername: 'solo1',
      empName: '独行',
      empPassword: 'pw',
    });
    deps.bcrypt = { hash: async () => 'h' };
    deps.toNullableUuid = () => null;
    deps.insertSalaryTimeline = async () => {};
    deps.stateFindUserRecord = () => ({ username: 'hr1', name: '' });
    const decideExtras = {};
    await onboarding.afterDecide({
      req: { tenantId: 'default' },
      deps,
      username: 'a1',
      decideExtras,
      updated: {
        id: 'onb-solo',
        type: 'onboarding',
        status: 'approved',
        applicant_username: 'hr1',
        payload: { employee: { name: '独行' } },
      },
    });
    const notifMerge = merges.find((m) => Array.isArray(m.patch.notifications));
    assert.ok(notifMerge);
    assert.equal(notifMerge.patch.notifications.length, 1);
    assert.equal(notifMerge.patch.notifications[0].u, 'hr1');
    assert.match(notifMerge.patch.notifications[0].msg, /独行/);
  }
  {
    const { deps, notifs } = makeDeps();
    deps.stateFindUserRecord = () => null;
    await onboarding.afterDecide({
      req: {},
      deps,
      nextAssignee: 'mgr1',
      updated: {
        id: 'onb-pend-default',
        type: 'onboarding',
        status: 'pending',
        applicant_username: 'hr1',
        payload: {},
      },
    });
    assert.ok(notifs.some((n) => n.title === '新员工入职审批待处理' && /「新员工」/.test(n.msg)));
  }
  {
    const { deps, notifs } = makeDeps();
    deps.getSharedState = async () => {
      throw new Error('boom');
    };
    await onboarding.afterDecide({
      req: {},
      deps,
      nextAssignee: 'mgr1',
      updated: {
        id: 'onb-outer',
        type: 'onboarding',
        status: 'pending',
        applicant_username: 'hr1',
        payload: { employee: { name: '甲' } },
      },
    });
    assert.equal(notifs.length, 0);
  }
  {
    await points.beforeUpdate({});
    await onboarding.beforeUpdate({});
  }
});

test('leave/points：autoDays；payload.store；pending 多条；rejected 有 note', async () => {
  {
    const { deps, notifs, queries } = makeDeps({ state: { leaveRecords: [] } });
    deps.calcDateSpanDaysInclusive = () => 3;
    deps.safeNumber = () => null;
    deps.pool.query = async (...a) => {
      queries.push(a);
      return { rows: [] };
    };
    await leave.afterDecide({
      req: { tenantId: 'default' },
      deps,
      username: 'a1',
      updated: {
        id: 'lv-auto',
        type: 'leave',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { beginDate: '2026-09-01', finishDate: '2026-09-03' },
      },
    });
    const ins = queries.find((q) => /INSERT INTO hrms_leave_records/i.test(String(q[0])));
    assert.equal(ins[1][7], 3);
    assert.ok(notifs.some((n) => n.title === '休假申请已通过'));
  }
  {
    const { deps, notifs, ledgerCalls } = makeDeps({
      depsExtra: {
        resolveAttendancePayrollRules: async () => ({ rules: { pointsYuanPerPoint: 1 } }),
      },
    });
    deps.stateFindUserRecord = () => ({ username: 'emp1', name: '甲', store: '旧店' });
    await points.afterDecide({
      req: { user: { username: 'a1', tenant_id: 't2' } },
      deps,
      nextAssignee: 'mgr1',
      updated: {
        id: 'pts-pend-multi',
        type: 'points',
        status: 'pending',
        applicant_username: 'emp1',
        payload: {
          store: '新店',
          items: [{ points: 1 }, { points: 2, reason: '二' }],
        },
      },
    });
    assert.equal(ledgerCalls.length, 0);
    assert.ok(notifs.some((n) => n.title === '积分申请待审批' && /2条积分事项/.test(n.msg)));
  }
  {
    const { deps, notifs, ledgerCalls } = makeDeps({
      depsExtra: {
        resolveAttendancePayrollRules: async () => ({ rules: { pointsYuanPerPoint: 2 } }),
      },
    });
    await points.afterDecide({
      req: { tenantId: 'default', user: { username: 'a1' } },
      deps,
      note: '超额',
      updated: {
        id: 'pts-rej-note',
        type: 'points',
        status: 'rejected',
        applicant_username: 'emp1',
        payload: { points: 9, store: '新店' },
      },
    });
    assert.equal(ledgerCalls.length, 0);
    assert.ok(notifs.some((n) => n.title === '积分申请未通过' && /超额/.test(n.msg)));
  }
});

test('L1 falsy：points/onboarding 空字段与 null state 回落', async () => {
  // type 空串：走 type||'' 后早退
  {
    const { deps, notifs } = makeDeps();
    await points.afterDecide({
      req: {},
      deps,
      updated: { id: 'pts-empty-type', type: '', status: 'approved', payload: { points: 1 } },
    });
    assert.equal(notifs.length, 0);
  }
  // getSharedState=null；申请人无名/无 manager；单条 points/itemName 空；tenant 全缺 → default
  {
    const { deps, notifs, queries, ledgerCalls } = makeDeps({
      depsExtra: {
        resolveAttendancePayrollRules: async () => ({ rules: { pointsYuanPerPoint: 1 } }),
      },
    });
    deps.getSharedState = async () => null;
    deps.stateFindUserRecord = () => ({ username: 'emp1', name: '' });
    deps.safeNumber = (n) => {
      const x = Number(n);
      return Number.isFinite(x) ? x : null;
    };
    deps.pool.query = async (...a) => {
      queries.push(a);
      return { rows: [] };
    };
    await points.afterDecide({
      req: { user: { username: 'a1' } },
      deps,
      updated: {
        id: '',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        payload: { points: null, itemName: '', reason: '', store: '' },
      },
    });
    assert.ok(ledgerCalls.length >= 1);
    assert.ok(notifs.some((n) => n.title === '积分申请已通过' && /积分事项/.test(n.msg)));
    const ins = queries.find((q) => /INSERT INTO point_records/i.test(String(q[0])));
    assert.ok(ins);
    assert.equal(ins[1][11], 'default');
  }
  // multi items：空 username/name/store/points；bizMonth 链空回落 month；pending 空 status
  {
    const { deps, notifs, ledgerCalls } = makeDeps({
      depsExtra: {
        resolveAttendancePayrollRules: async () => ({ rules: { pointsYuanPerPoint: 0.5 } }),
        safeBizMonth: () => '',
      },
    });
    deps.getSharedState = async () => ({});
    deps.stateFindUserRecord = () => ({ username: 'emp1', name: '甲', store: '店A' });
    deps.safeNumber = () => null;
    deps.pool.query = async () => ({ rows: [] });
    await points.afterDecide({
      req: { tenantId: 't1', user: { username: 'a1' } },
      deps,
      updated: {
        id: 'pts-empty-items',
        type: 'points',
        status: 'approved',
        applicant_username: 'emp1',
        created_at: '',
        updated_at: '',
        payload: {
          items: [
            { username: '', name: '', store: '', points: null, itemName: '', reason: '', bizMonth: '', occurDate: '', date: '' },
          ],
        },
      },
    });
    assert.ok(ledgerCalls.length >= 1);
    assert.ok(notifs.some((n) => n.title === '积分申请已通过'));
  }
  {
    const { deps, notifs } = makeDeps();
    await points.afterDecide({
      req: {},
      deps,
      nextAssignee: 'mgr1',
      updated: {
        id: 'pts-status-empty',
        type: 'points',
        status: '',
        applicant_username: 'emp1',
        payload: { itemName: '', items: [{ reason: '', points: 1 }] },
      },
    });
    // status 空：非 approved/rejected/pending，不通知
    assert.equal(notifs.length, 0);
  }
  // pending 单条：无 itemName，走 rawItems[0].reason；再测全空 → 积分事项
  {
    const { deps, notifs } = makeDeps();
    await points.afterDecide({
      req: {},
      deps,
      nextAssignee: 'mgr1',
      updated: {
        id: 'pts-pend-reason',
        type: 'points',
        status: 'pending',
        applicant_username: 'emp1',
        payload: { items: [{ points: 2, reason: '加班' }] },
      },
    });
    assert.ok(notifs.some((n) => n.title === '积分申请待审批' && /加班/.test(n.msg)));
  }
  {
    const { deps, notifs } = makeDeps();
    await points.afterDecide({
      req: {},
      deps,
      nextAssignee: 'mgr1',
      updated: {
        id: 'pts-pend-fallback',
        type: 'points',
        status: 'pending',
        applicant_username: 'emp1',
        payload: { items: [{ points: 1 }] },
      },
    });
    assert.ok(notifs.some((n) => n.title === '积分申请待审批' && /积分事项/.test(n.msg)));
  }

  // onboarding：updated=null；getSharedState=null；err 无 message；空 dept/position/store/role
  {
    const { deps } = makeDeps();
    await onboarding.afterDecide({ req: {}, deps, updated: null, decideExtras: {} });
  }
  {
    const { deps } = makeDeps();
    deps.getSharedState = async () => null;
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: true,
      nextEmp: {
        username: 'newf1',
        name: '空档',
        role: '',
        department: '',
        position: '',
        store: '',
        salary: 1000,
        joinDate: '',
        managerUsername: '',
      },
      newUsername: 'newf1',
      empName: '空档',
      empPassword: 'pw',
    });
    deps.bcrypt = { hash: async () => 'h' };
    deps.toNullableUuid = () => '00000000-0000-4000-8000-000000000099';
    deps.insertSalaryTimeline = async () => {};
    let userCalls = 0;
    deps.pool.query = async (sql) => {
      userCalls += 1;
      if (userCalls === 1) throw 42; // 无 message，走 String(userErr)
      if (/feishu_users/i.test(String(sql))) throw 'feishu bare';
      return { rows: [] };
    };
    const decideExtras = {};
    await onboarding.afterDecide({
      req: { user: {} },
      deps,
      username: 'a1',
      decideExtras,
      updated: {
        id: 'onb-falsy',
        type: 'onboarding',
        status: 'approved',
        applicant_username: '',
        payload: { employee: { name: '空档', open_id: 'x' } },
      },
    });
    // users 失败后仍可能尝试飞书；sync 成功才进飞书——users 失败不挡 sync.ok
    assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
  }
  {
    const { deps } = makeDeps();
    deps.getSharedState = async () => ({
      employees: [
        { username: 'sm1', store: '', role: 'store_manager' },
        { username: 'sm2', store: '目标店', role: '' },
        { username: 'sm3', store: '目标店', role: 'store_manager' },
      ],
    });
    deps.buildOnboardingEmployeeRecordFromPayload = () => ({
      ok: true,
      nextEmp: {
        username: 'newsm',
        name: '店长测',
        role: 'store_employee',
        department: 'd',
        position: 'p',
        store: '目标店',
        salary: 2000,
        joinDate: '2026-07-01',
        managerUsername: '',
      },
      newUsername: 'newsm',
      empName: '店长测',
      empPassword: 'pw',
    });
    deps.bcrypt = { hash: async () => 'h' };
    deps.toNullableUuid = () => null;
    deps.insertSalaryTimeline = async () => {};
    deps.stateFindUserRecord = () => ({ username: 'hr1', name: '' });
    deps.pool.query = async () => ({ rows: [] });
    let notifBoom = false;
    deps.mergeSharedStateFields = async (patch, keys) => {
      if (Array.isArray(patch.notifications)) {
        if (!notifBoom) {
          notifBoom = true;
          throw 'notif bare';
        }
      }
    };
    const decideExtras = {};
    await onboarding.afterDecide({
      req: { tenantId: 'default' },
      deps,
      username: 'a1',
      decideExtras,
      updated: {
        id: 'onb-sm-find',
        type: 'onboarding',
        status: 'approved',
        applicant_username: 'hr1',
        payload: { employee: { name: '店长测' } },
      },
    });
    assert.equal(decideExtras.onboardingEmployeeSync?.ok, true);
  }
  {
    const { deps, notifs } = makeDeps();
    deps.getSharedState = async () => null;
    deps.stateFindUserRecord = () => null;
    await onboarding.afterDecide({
      req: {},
      deps,
      nextAssignee: 'mgr1',
      note: '',
      updated: {
        id: 'onb-pend-falsy',
        type: 'onboarding',
        status: 'pending',
        applicant_username: '',
        payload: { employee: null },
      },
    });
    assert.ok(notifs.some((n) => n.title === '新员工入职审批待处理'));
  }
  {
    const { deps, notifs } = makeDeps();
    await onboarding.afterDecide({
      req: {},
      deps,
      updated: {
        id: 'onb-rej-status',
        type: 'onboarding',
        status: 'rejected',
        applicant_username: 'hr1',
        payload: {},
      },
    });
    assert.ok(notifs.some((n) => n.title === '新员工入职审批被拒绝'));
  }
});
