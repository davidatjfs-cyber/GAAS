import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePromotionApplicantContext,
  buildFormalPromotionEmployeeUpdate,
  applyFormalPromotionSalaryTimeline,
  assignFormalPromotionTraining,
  markFormalPromotionTrackPromoted,
  handleFormalPromotionApproved,
  resolveQualificationRequiredTopics,
  computeQualificationTrainingDueDate,
  buildQualificationPromotionTrack,
  handleQualificationPromotionApproved,
  handlePromotionRejected,
  notifyPromotionPendingAssignee,
} from '../promotion-after-decide-helpers.js';

function makePromotionDeps(overrides = {}) {
  const notifs = [];
  const mergeCalls = [];
  return {
    notifs,
    mergeCalls,
    deps: {
      stateFindUserRecord: (state, u) =>
        (state.employees || []).find(
          (e) => String(e.username || '').trim().toLowerCase() === String(u || '').trim().toLowerCase()
        ) || null,
      hrmsNowISO: () => '2026-07-26T10:00:00+08:00',
      makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
      appendNotifications: async (arr) => {
        notifs.push(...(Array.isArray(arr) ? arr : [arr]));
      },
      mergeSharedStateFields: async (fields, keys) => {
        mergeCalls.push({ fields, keys });
      },
      uniqUsernames: (arr) => [...new Set((arr || []).map((x) => String(x || '').trim()).filter(Boolean))],
      safeDateOnly: (v) => {
        const s = String(v || '').trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
      },
      randomUUID: () => 'uuid-track-1',
      findUserSalary: (_state, u) => (u === 'emp1' ? 5000 : 0),
      insertSalaryTimeline: async () => {},
      applyPromotionSalaryNextMonth: async () => {},
      createTrainingAssignment: async (opts) => {
        mergeCalls.push({ training: opts });
      },
      getPromotionRequiredTopics: async (pos) =>
        pos === '副店长' ? [{ id: 1, title: '管理基础' }] : [],
      getPromotionTrackProgress: async () => ({ items: [{ topicId: 1, certified: true }] }),
      normalizePromotionTrainingPeriods: (raw) =>
        Array.isArray(raw) ? raw.filter((p) => p?.startDate && p?.endDate) : [],
      isKitchenByRoleOrPosition: () => false,
      pickHqManagerUsername: async () => 'hq1',
      pickStoreRoleUsernameByStore: () => 'mgr1',
      getSharedState: async () => ({
        promotionTracks: [{ id: 'track-old', status: 'qualification_approved' }],
      }),
      pool: {
        query: async () => ({ rows: [{ id: 9, title: '技能课', sort_order: 1, is_active: true }] }),
      },
      ...overrides,
    },
  };
}

test('resolvePromotionApplicantContext / buildFormalPromotionEmployeeUpdate', () => {
  const { deps } = makePromotionDeps();
  const state0 = {
    employees: [{ username: 'emp1', name: '张三', managerUsername: 'mgr1', store: '测试店', level: 'L1', position: '服务员' }],
  };
  const updated = {
    type: 'promotion',
    id: 100,
    applicant_username: 'emp1',
    status: 'approved',
    payload: { promotionStage: 'formal', newLevel: 'L2', newPosition: '领班', promotedSalary: 6000, reason: '表现好' },
    chain: [{ step: 1, assignee: 'mgr1', status: 'approved', decidedAt: '2026-07-26' }],
  };
  const ctx = { ...resolvePromotionApplicantContext(state0, updated, deps), decidedBy: 'mgr1' };
  assert.equal(ctx.applicantName, '张三');
  assert.equal(ctx.finalApproved, true);
  assert.equal(ctx.stage, 'formal');

  const upd = buildFormalPromotionEmployeeUpdate(state0, ctx, updated, deps);
  assert.equal(upd.hasPromotedSalary, true);
  assert.equal(upd.state.employees[0].level, 'L2');
  assert.equal(upd.state.salaryChangeHistory.length, 1);
  assert.equal(upd.state.salaryChangeHistory[0].newSalary, 6000);
});

test('buildFormalPromotionEmployeeUpdate skill_bump 不改职级', () => {
  const { deps } = makePromotionDeps();
  const state0 = { employees: [{ username: 'emp1', level: 'L1', position: '厨师' }] };
  const updated = {
    id: 1,
    payload: { promoTier: 'skill_bump', promotedSalary: 5500 },
  };
  const ctx = { ...resolvePromotionApplicantContext(state0, updated, deps), decidedBy: 'mgr1', applicantUser: 'emp1' };
  const upd = buildFormalPromotionEmployeeUpdate(state0, ctx, updated, deps);
  assert.equal(upd.isSkillBump, true);
  assert.equal(upd.state.employees[0].level, 'L1');
});

test('applyFormalPromotionSalaryTimeline / markFormalPromotionTrackPromoted', async () => {
  const timelineCalls = [];
  const { deps } = makePromotionDeps({
    insertSalaryTimeline: async (opts) => timelineCalls.push(['baseline', opts]),
    applyPromotionSalaryNextMonth: async (opts) => timelineCalls.push(['next', opts]),
  });
  await applyFormalPromotionSalaryTimeline({
    req: { tenantId: 'default' },
    deps,
    updated: { id: 5 },
    ctx: { applicantUser: 'emp1', applicant: { joinDate: '2025-01-01' }, decidedBy: 'mgr1' },
    promotedSalary: 6000,
    oldSalary: 5000,
    hasPromotedSalary: true,
  });
  assert.equal(timelineCalls.length, 2);

  const marked = markFormalPromotionTrackPromoted(
    { promotionTracks: [{ id: 't1', status: 'qualification_approved' }] },
    't1',
    deps
  );
  assert.equal(marked.trackIdx, 0);
  assert.equal(marked.tracks[0].status, 'promoted');
});

test('assignFormalPromotionTraining skips certified topics', async () => {
  const assigned = [];
  const { deps } = makePromotionDeps({
    getPromotionRequiredTopics: async () => [{ id: 1, title: 'A' }, { id: 2, title: 'B' }],
    getPromotionTrackProgress: async () => ({ items: [{ topicId: 1, certified: true }] }),
    createTrainingAssignment: async (o) => assigned.push(o.topicId),
  });
  await assignFormalPromotionTraining({
    req: {},
    deps,
    updated: { payload: { promotionTrackId: 't1' } },
    ctx: { applicantUser: 'emp1', applicantManager: 'mgr1', decidedBy: 'mgr1' },
    employeeUpdate: { isSkillBump: false, newPosition: '副店长', newLevel: 'L2' },
  });
  assert.deepEqual(assigned, [2]);
});

test('handleFormalPromotionApproved merges state + notifies', async () => {
  const { deps, notifs, mergeCalls } = makePromotionDeps();
  const state0 = {
    employees: [{ username: 'emp1', name: '张三', managerUsername: 'mgr1', store: '测试店', level: 'L1', position: '服务员' }],
    promotionTracks: [{ id: 'track-old', status: 'qualification_approved' }],
  };
  const updated = {
    type: 'promotion',
    id: 100,
    applicant_username: 'emp1',
    status: 'approved',
    payload: {
      promotionStage: 'formal',
      promotionTrackId: 'track-old',
      newLevel: 'L2',
      newPosition: '领班',
      promotedSalary: 6000,
    },
    chain: [],
  };
  const ctx = { ...resolvePromotionApplicantContext(state0, updated, deps), decidedBy: 'mgr1' };
  await handleFormalPromotionApproved({ req: {}, deps, updated, ctx, state0 });
  assert.ok(mergeCalls.length >= 1);
  assert.ok(notifs.length >= 1 || mergeCalls.some((c) => c.fields?.notifications));
});

test('resolveQualificationRequiredTopics / computeQualificationTrainingDueDate / buildQualificationPromotionTrack', async () => {
  const { deps } = makePromotionDeps();
  const updated = {
    id: 2,
    payload: {
      targetPosition: '副店长',
      targetLevel: 'L2',
      mentorUsername: 'mentor1',
      mentorName: '带教甲',
      trainingPeriods: [{ startDate: '2026-08-01', endDate: '2026-08-07' }],
    },
  };
  const ctx = resolvePromotionApplicantContext(
    { employees: [{ username: 'emp1', name: '李四', role: 'store_employee', store: '测试店' }] },
    { ...updated, applicant_username: 'emp1', type: 'promotion', status: 'approved' },
    deps
  );
  const topics = await resolveQualificationRequiredTopics({ pool: deps.pool, deps, updated, ctx });
  assert.equal(topics.length, 1);

  const trainingMeta = computeQualificationTrainingDueDate(updated.payload, deps);
  assert.equal(trainingMeta.trainingDueDate, '2026-08-07');

  const trackBuild = buildQualificationPromotionTrack({
    updated,
    ctx: { ...ctx, applicantUser: 'emp1', applicantName: '李四', applicantRole: 'store_employee', applicantStore: '测试店', applicantDepartment: '', applicantPosition: '' },
    requiredTopics: topics,
    trainingMeta,
    deps,
  });
  assert.equal(trackBuild.track.status, 'qualification_approved');
  assert.deepEqual(trackBuild.track.requiredTopicIds, [1]);
});

test('resolveQualificationRequiredTopics skill_bump uses pool', async () => {
  const { deps } = makePromotionDeps();
  const updated = { payload: { promoTier: 'skill_bump', selectedTopicIds: [9] } };
  const topics = await resolveQualificationRequiredTopics({ pool: deps.pool, deps, updated, ctx: {} });
  assert.equal(topics[0].id, 9);
});

test('handleQualificationPromotionApproved appends notifications + track', async () => {
  const { deps, notifs, mergeCalls } = makePromotionDeps({
    getPromotionRequiredTopics: async () => [{ id: 3, title: '服务规范' }],
  });
  const state0 = { employees: [{ username: 'emp1', name: '王五', store: '测试店' }] };
  const updated = {
    id: 3,
    applicant_username: 'emp1',
    status: 'approved',
    payload: { promotionStage: 'qualification', targetPosition: '领班', mentorUsername: 'mentor1' },
  };
  const ctx = { ...resolvePromotionApplicantContext(state0, updated, deps), decidedBy: 'mgr1' };
  const next = await handleQualificationPromotionApproved({ req: {}, deps, updated, ctx, state0 });
  assert.equal(next.promotionTracks.length, 1);
  assert.ok(notifs.length >= 1);
  assert.ok(mergeCalls.some((c) => c.fields?.promotionTracks));
});

test('handlePromotionRejected notifies + updates formal track', async () => {
  const { deps, notifs, mergeCalls } = makePromotionDeps();
  const updated = {
    id: 4,
    status: 'rejected',
    payload: { promotionStage: 'formal', promotionTrackId: 'track-old' },
  };
  const ctx = {
    applicantUser: 'emp1',
    applicantName: '赵六',
    applicantManager: 'mgr1',
    stage: 'formal',
  };
  await handlePromotionRejected({ req: {}, deps, updated, note: '培训未达标', ctx });
  assert.ok(notifs.some((n) => n.msg.includes('培训未达标')));
  assert.ok(mergeCalls.some((c) => c.fields?.promotionTracks?.[0]?.status === 'formal_rejected'));
});

test('notifyPromotionPendingAssignee includes mentor tip for store_manager', async () => {
  const { deps, notifs } = makePromotionDeps();
  await notifyPromotionPendingAssignee({
    deps,
    updated: { id: 6 },
    nextAssignee: 'mgr1',
    ctx: { applicantName: '钱七', stage: 'qualification' },
    state: { employees: [{ username: 'mgr1', role: 'store_manager' }] },
  });
  assert.ok(notifs[0].msg.includes('指定带教人'));
});

test('applyFormalPromotionSalaryTimeline skips when no salary', async () => {
  const { deps } = makePromotionDeps({ insertSalaryTimeline: async () => assert.fail('should not call') });
  await applyFormalPromotionSalaryTimeline({
    req: {},
    deps,
    updated: {},
    ctx: { applicantUser: 'emp1', decidedBy: 'mgr1' },
    promotedSalary: 0,
    oldSalary: 0,
    hasPromotedSalary: false,
  });
});

test('assignFormalPromotionTraining returns early for skill_bump', async () => {
  const { deps } = makePromotionDeps({ createTrainingAssignment: async () => assert.fail('skip') });
  const trackId = await assignFormalPromotionTraining({
    req: {},
    deps,
    updated: { payload: {} },
    ctx: { applicantUser: 'emp1', decidedBy: 'mgr1' },
    employeeUpdate: { isSkillBump: true, newPosition: '厨师' },
  });
  assert.equal(trackId, '');
});
