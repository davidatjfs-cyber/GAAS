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

function makePromotionAfterDeps(overrides = {}) {
  const merges = [];
  const notifs = [];
  const trainings = [];
  const salaryCalls = [];
  const timelineCalls = [];
  let state = overrides.state || {
    employees: [{
      username: 'emp1',
      name: '员工甲',
      managerUsername: 'mgr1',
      store: '测试店',
      role: 'store_employee',
      position: '服务员',
      level: '初级',
      department: '前厅',
      salary: 5000,
      joinDate: '2025-01-15',
    }],
    promotionTracks: overrides.tracks || [
      { id: 'track-1', status: 'qualification_approved', applicantUsername: 'emp1' },
    ],
    salaryChangeHistory: [],
  };
  const deps = {
    pool: {
      query: async (sql, params) => {
        if (sql.includes('training_topics') && sql.includes('ANY')) {
          return {
            rows: (params[0] || []).map((id) => ({ id, title: `课题${id}`, is_active: true })),
          };
        }
        return { rows: [] };
      },
    },
    hrmsNowISO: () => '2026-07-25T12:00:00+08:00',
    makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
    appendNotifications: async (items) => {
      notifs.push(...items);
    },
    getSharedState: async () => state,
    mergeSharedStateFields: async (patch, idFields) => {
      merges.push({ patch, idFields });
      if (patch.employees) state = { ...state, employees: patch.employees };
      if (patch.promotionTracks) state = { ...state, promotionTracks: patch.promotionTracks };
      if (patch.salaryChangeHistory) {
        state = { ...state, salaryChangeHistory: patch.salaryChangeHistory };
      }
    },
    stateFindUserRecord: (_s, u) => {
      const key = String(u || '').toLowerCase();
      if (key === 'emp1') return state.employees[0];
      if (key === 'sm1') return { username: 'sm1', role: 'store_manager', name: '店长' };
      if (key === 'hq1') return { username: 'hq1', role: 'hq_manager' };
      return null;
    },
    uniqUsernames: (a) => [...new Set((a || []).filter(Boolean))],
    safeDateOnly: (d) => (d ? String(d).slice(0, 10) : ''),
    randomUUID: () => 'uuid-promo-1',
    createTrainingAssignment: async (args) => {
      trainings.push(args);
    },
    applyPromotionSalaryNextMonth: async (args) => {
      salaryCalls.push(args);
    },
    insertSalaryTimeline: async (args) => {
      timelineCalls.push(args);
    },
    findUserSalary: (_s, u) => (u === 'emp1' ? 5000 : null),
    getPromotionRequiredTopics: async (pos) =>
      pos ? [{ id: 11, title: `${pos}-必修` }] : [],
    getPromotionTrackProgress: async () => ({
      items: [{ topicId: 11, certified: false }],
    }),
    normalizePromotionTrainingPeriods: (p) => (Array.isArray(p) ? p : []),
    isKitchenByRoleOrPosition: (role, pos, dept) =>
      String(dept || '').includes('厨房') || String(pos || '').includes('厨'),
    pickHqManagerUsername: async () => 'hq1',
    pickStoreRoleUsernameByStore: (_s, store, roles) => {
      if (roles.includes('store_manager')) return 'sm1';
      if (roles.includes('store_production_manager')) return 'pm1';
      return '';
    },
    ...overrides.depsExtra,
  };
  return { deps, merges, notifs, trainings, salaryCalls, timelineCalls, getState: () => state };
}

test('promotion afterDecide：正式通过写职级/薪资/培训；资格通过建 track；拒绝与待审', async () => {
  const formal = makePromotionAfterDeps();
  await promotion.afterDecide({
    req: { tenantId: 'default', user: {} },
    deps: formal.deps,
    username: 'approver1',
    note: '',
    nextAssignee: null,
    updated: {
      id: 'ap-formal',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'emp1',
      chain: [{ step: 1, assignee: 'sm1', status: 'approved', decidedAt: '2026-07-25' }],
      payload: {
        promotionStage: 'formal',
        promoTier: 'level_promotion',
        newLevel: '中级',
        newPosition: '领班',
        reason: '表现优秀',
        promotedSalary: 6500,
        promotionTrackId: 'track-1',
        store: '测试店',
      },
    },
  });
  assert.ok(formal.merges.some((m) => m.patch.employees?.[0]?.level === '中级'));
  assert.ok(formal.merges.some((m) => m.patch.employees?.[0]?.position === '领班'));
  assert.ok(formal.merges.some((m) => m.patch.employees?.[0]?.salary === 6500));
  assert.ok(formal.merges.some((m) => m.patch.promotionTracks?.[0]?.status === 'promoted'));
  assert.ok(formal.merges.some((m) =>
    Array.isArray(m.patch.salaryChangeHistory)
    && m.patch.salaryChangeHistory[0]?.source === 'promotion_formal'));
  assert.equal(formal.timelineCalls.length, 1);
  assert.equal(formal.salaryCalls[0]?.newSalary, 6500);
  assert.ok(formal.trainings.some((t) => t.source === 'promotion_formal' && t.topicId === 11));
  assert.ok(formal.notifs.some((n) => n.title === '晋升申请已通过') ||
    formal.merges.some((m) => m.patch.notifications?.some((n) => n.title === '晋升申请已通过')));

  // 正式通过：技能提升不改岗、无培训课题
  const skill = makePromotionAfterDeps({
    tracks: [{ id: 'track-s', status: 'qualification_approved', applicantUsername: 'emp1' }],
  });
  skill.deps.getPromotionRequiredTopics = async () => [];
  await promotion.afterDecide({
    req: { tenantId: 'default' },
    deps: skill.deps,
    username: 'approver1',
    note: '',
    nextAssignee: null,
    updated: {
      id: 'ap-skill',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'emp1',
      payload: {
        promotionStage: 'formal',
        promoTier: 'skill_bump',
        newLevel: '高级',
        newPosition: '主厨',
        reason: '技能',
        promotedSalary: 0,
        promotionTrackId: 'track-s',
      },
    },
  });
  const skillEmp = skill.merges.find((m) => m.patch.employees)?.patch.employees[0];
  assert.equal(skillEmp.level, '初级');
  assert.equal(skillEmp.position, '服务员');
  assert.equal(skill.trainings.length, 0);
  assert.equal(skill.salaryCalls.length, 0);

  // 资格通过：建 track + 培训 + 厨房含出品经理
  const qual = makePromotionAfterDeps({
    state: {
      employees: [{
        username: 'emp1',
        name: '厨工甲',
        managerUsername: 'mgr1',
        store: '测试店',
        role: 'store_employee',
        position: '厨工',
        level: '初级',
        department: '厨房',
      }],
      promotionTracks: [],
      salaryChangeHistory: [],
    },
  });
  await promotion.afterDecide({
    req: { tenantId: 't1', user: { tenant_id: 't1' } },
    deps: qual.deps,
    username: 'sm1',
    note: '',
    nextAssignee: null,
    updated: {
      id: 'ap-qual',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'emp1',
      payload: {
        promotionStage: 'qualification',
        targetPosition: '出品经理',
        targetLevel: '储备',
        mentorUsername: 'mentor1',
        mentorName: '带教A',
        trainingStartDate: '2026-08-01',
        trainingDays: 5,
        trainingPeriods: [{ startDate: '2026-08-01', endDate: '2026-08-05' }],
        promoTier: 'level_promotion',
        currentLevel: '初级',
        currentPosition: '厨工',
      },
    },
  });
  assert.ok(qual.merges.some((m) =>
    m.patch.promotionTracks?.[0]?.status === 'qualification_approved'
    && m.patch.promotionTracks[0].mentorUsername === 'mentor1'));
  assert.ok(qual.trainings.some((t) => t.source === 'promotion_qualification'));
  assert.ok(qual.notifs.some((n) => n.title === '晋升资格申请已批准'));
  assert.ok(qual.notifs.some((n) => n.u === 'pm1'), '厨房应通知出品经理');
  assert.ok(qual.notifs.some((n) => n.title === '晋升培训任务已生成'));

  // skill_bump 资格：按 selectedTopicIds 查课题
  const bump = makePromotionAfterDeps({
    state: {
      employees: [{ username: 'emp1', name: '甲', managerUsername: 'mgr1', store: '测试店', role: 'store_employee', position: '服务员', department: '前厅' }],
      promotionTracks: [],
    },
  });
  await promotion.afterDecide({
    req: {},
    deps: bump.deps,
    username: 'sm1',
    note: '',
    nextAssignee: null,
    updated: {
      id: 'ap-bump',
      type: 'promotion',
      status: 'approved',
      applicant_username: 'emp1',
      payload: {
        promotionStage: 'qualification',
        promoTier: 'skill_bump',
        selectedTopicIds: [21, 22],
        targetPosition: '服务员',
        mentorUsername: 'm1',
      },
    },
  });
  assert.equal(bump.trainings.length, 2);
  assert.ok(bump.trainings.every((t) => [21, 22].includes(t.topicId)));

  // 正式拒绝：track → formal_rejected
  const rej = makePromotionAfterDeps();
  await promotion.afterDecide({
    req: {},
    deps: rej.deps,
    username: 'hq1',
    note: '材料不足',
    nextAssignee: null,
    updated: {
      id: 'ap-rej',
      type: 'promotion',
      status: 'rejected',
      applicant_username: 'emp1',
      payload: { promotionStage: 'formal', promotionTrackId: 'track-1' },
    },
  });
  assert.ok(rej.notifs.some((n) => n.title === '晋升申请未通过' && /材料不足/.test(n.msg)));
  assert.ok(rej.merges.some((m) => m.patch.promotionTracks?.[0]?.status === 'formal_rejected'));

  // pending + 下一审批人是店长 → 带教提示
  const pend = makePromotionAfterDeps();
  await promotion.afterDecide({
    req: {},
    deps: pend.deps,
    username: 'mgr1',
    note: '',
    nextAssignee: 'sm1',
    updated: {
      id: 'ap-pend',
      type: 'promotion',
      status: 'pending',
      applicant_username: 'emp1',
      payload: { promotionStage: 'qualification' },
    },
  });
  assert.ok(pend.notifs.some((n) =>
    n.u === 'sm1'
    && n.title === '晋升申请待审批'
    && /指定带教人/.test(n.msg)));
});
