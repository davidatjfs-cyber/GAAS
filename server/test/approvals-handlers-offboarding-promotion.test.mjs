/**
 * L1：离职/晋升审批 handler 的 beforeUpdate / afterDecide（mock deps）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as offboarding from '../domains/approvals/handlers/offboarding.js';
import * as promotion from '../domains/approvals/handlers/promotion.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('offboarding beforeUpdate：pre 写 departureType；post 写 effectiveDate', async () => {
  const payload = { resignDate: '2026-08-20' };
  const ctx = {
    row: { type: 'offboarding' },
    departureType: 'voluntary',
    updatedPayload: payload,
    nextStatus: 'approved',
    beforeChain: true,
    deps: { safeDateOnly: (d) => String(d || '').slice(0, 10) },
  };
  await offboarding.beforeUpdate(ctx);
  assert.equal(payload.departureType, 'voluntary');

  ctx.beforeChain = false;
  await offboarding.beforeUpdate(ctx);
  assert.equal(ctx.effectiveDate, '2026-08-20');
});

test('offboarding afterDecide：通过立即关闭 / 拒绝通知 / 待审批', async () => {
  const merges = [];
  const notifs = [];
  const deps = {
    hrmsNowISO: () => '2026-07-25T12:00:00+08:00',
    shanghaiTodayDateOnly: () => '2026-07-25',
    safeDateOnly: (d) => (d ? String(d).slice(0, 10) : ''),
    makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
    appendNotifications: async (items) => {
      notifs.push(...items);
    },
    getSharedState: async () => ({
      employees: [
        { username: 'emp1', name: '员工甲', managerUsername: 'mgr1', status: 'active' },
      ],
      users: [{ username: 'emp1', status: 'active' }],
    }),
    mergeSharedStateFields: async (patch, idFields) => {
      merges.push({ patch, idFields });
    },
    stateFindUserRecord: (_s, u) =>
      u === 'emp1' ? { username: 'emp1', name: '员工甲', managerUsername: 'mgr1' } : null,
    uniqUsernames: (a) => [...new Set(a.filter(Boolean))],
  };

  // 离职日已到 → disableNow
  await offboarding.afterDecide({
    deps,
    updated: {
      id: 'ob1',
      type: 'offboarding',
      status: 'approved',
      applicant_username: 'emp1',
      payload: { resignDate: '2026-07-20' },
    },
    nextAssignee: null,
    note: '',
  });
  assert.ok(notifs.some((n) => n.title === '离职申请已通过'));
  assert.ok(merges.some((m) => m.patch.employees?.[0]?.status === '离职'));
  assert.ok(merges.some((m) => m.patch.users?.[0]?.status === '离职'));

  notifs.length = 0;
  merges.length = 0;
  await offboarding.afterDecide({
    deps,
    updated: {
      id: 'ob2',
      type: 'offboarding',
      status: 'rejected',
      applicant_username: 'emp1',
      payload: {},
    },
    note: '再谈一次',
  });
  assert.ok(notifs.some((n) => n.title === '离职申请被拒绝' && /再谈一次/.test(n.msg)));
  assert.equal(merges.length, 0);

  merges.length = 0;
  await offboarding.afterDecide({
    deps,
    updated: {
      id: 'ob3',
      type: 'offboarding',
      status: 'pending',
      applicant_username: 'emp1',
      payload: {},
    },
    nextAssignee: 'hq1',
  });
  assert.ok(merges.some((m) => m.patch.notifications?.[0]?.u === 'hq1'));
});

test('promotion beforeUpdate：缺带教 / 带教不存在 / 正式晋升缺薪资', async () => {
  const res = mockRes();
  const missMentor = await promotion.beforeUpdate({
    res,
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-25T12:00:00+08:00',
    approved: true,
    mentorUsernameRaw: '',
    mentorNameRaw: '',
    trainingStartDateRaw: '',
    trainingDaysRaw: 0,
    trainingPeriodsRaw: [],
    promotedSalaryRaw: null,
    updatedPayload: { promotionStage: 'qualification' },
    deps: {
      pool: { query: async () => ({ rows: [] }) },
      safeDateOnly: (d) => (d ? String(d).slice(0, 10) : ''),
      normalizePromotionTrainingPeriods: () => [],
    },
  });
  assert.equal(missMentor.abort, true);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'missing_mentor');

  const res2 = mockRes();
  const notFound = await promotion.beforeUpdate({
    res: res2,
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-25T12:00:00+08:00',
    approved: true,
    mentorUsernameRaw: 'ghost',
    mentorNameRaw: '幽灵',
    trainingStartDateRaw: '2026-08-01',
    trainingDaysRaw: 7,
    trainingPeriodsRaw: [{ start: '2026-08-01', end: '2026-08-07' }],
    promotedSalaryRaw: null,
    updatedPayload: { promotionStage: 'qualification' },
    deps: {
      pool: { query: async () => ({ rows: [] }) },
      safeDateOnly: (d) => (d ? String(d).slice(0, 10) : ''),
      normalizePromotionTrainingPeriods: (p) => (Array.isArray(p) ? p : []),
    },
  });
  assert.equal(notFound.abort, true);
  assert.equal(res2.body.error, 'mentor_not_found');

  const payload = { promotionStage: 'qualification' };
  const ok = await promotion.beforeUpdate({
    res: mockRes(),
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-25T12:00:00+08:00',
    approved: true,
    mentorUsernameRaw: 'mentor1',
    mentorNameRaw: '带教',
    trainingStartDateRaw: '2026-08-01',
    trainingDaysRaw: 7,
    trainingPeriodsRaw: [{ start: 'a' }],
    promotedSalaryRaw: null,
    updatedPayload: payload,
    deps: {
      pool: { query: async () => ({ rows: [{ '?column?': 1 }] }) },
      safeDateOnly: (d) => (d ? String(d).slice(0, 10) : ''),
      normalizePromotionTrainingPeriods: (p) => p,
    },
  });
  assert.equal(ok, undefined);
  assert.equal(payload.mentorUsername, 'mentor1');
  assert.equal(payload.trainingDays, 7);

  const res3 = mockRes();
  const noSal = await promotion.beforeUpdate({
    res: res3,
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-25T12:00:00+08:00',
    approved: true,
    mentorUsernameRaw: '',
    mentorNameRaw: '',
    trainingStartDateRaw: '',
    trainingDaysRaw: 0,
    trainingPeriodsRaw: [],
    promotedSalaryRaw: null,
    updatedPayload: { promotionStage: 'formal' },
    deps: {
      pool: { query: async () => ({ rows: [] }) },
      safeDateOnly: () => '',
      normalizePromotionTrainingPeriods: () => [],
    },
  });
  assert.equal(noSal.abort, true);
  assert.equal(res3.body.error, 'missing_promoted_salary');

  const formalPayload = { promotionStage: 'formal' };
  await promotion.beforeUpdate({
    res: mockRes(),
    row: { type: 'promotion' },
    role: 'store_manager',
    username: 'mgr1',
    nowIso: '2026-07-25T12:00:00+08:00',
    approved: true,
    mentorUsernameRaw: '',
    mentorNameRaw: '',
    trainingStartDateRaw: '',
    trainingDaysRaw: 0,
    trainingPeriodsRaw: [],
    promotedSalaryRaw: 6500.5,
    updatedPayload: formalPayload,
    deps: {
      pool: { query: async () => ({ rows: [] }) },
      safeDateOnly: () => '',
      normalizePromotionTrainingPeriods: () => [],
    },
  });
  assert.equal(formalPayload.promotedSalary, 6500.5);
});
