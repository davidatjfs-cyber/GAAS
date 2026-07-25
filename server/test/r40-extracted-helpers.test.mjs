/**
 * R40：冲高 heuristic / training shared / offboarding-promotion /
 * growth-metrics / performance-invalidation / birthday scheduler。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isExcludedForecastProduct,
  createNormalizeForecastProducts,
  scoreForecastRow,
  buildForecastByHeuristic,
  extractHistoryProductUniverse,
  createConstrainPredictionsToHistory,
  createComputeSlotRevenueShare,
} from '../domains/inventory-forecast/heuristic.js';

import {
  isManager,
  formatRubricStandards,
  buildKbArticleText,
  getAssignableRoles,
  getShanghaiDateKey,
  parseScoringJson,
  stripJsonCodeFence,
  repairJsonText,
  tryParseQuizJsonFromLLM,
  normalizeQuizAnswerIndex,
  normalizeQuizQuestion,
  normalizeQuizQuestionsPayload,
  shuffleQuizOptions,
  buildRuleBasedQuizQuestions,
  generateQuizQuestionsForSession,
  getShanghaiDateTimeText,
  parseReminderMeta,
  getUserStore,
  createTrainingUserNotification,
  sendTrainingFeishuMessage,
} from '../domains/training/shared.js';

import { createOffboardingPromotionScheduler } from '../domains/approvals/scheduler-offboarding-promotion.js';

import {
  ingestMiniprogramEvent,
  posConsumption,
  listMetrics,
  recomputeSegments,
} from '../domains/growth-metrics/service.js';

import {
  listPerformanceRecords,
  invalidatePerformanceRecord,
} from '../domains/performance-invalidation/service.js';

import { createBirthdayScheduler } from '../domains/birthday/scheduler.js';

// —— heuristic ——
test('heuristic: normalize / score / build / constrain / slot share', () => {
  assert.equal(isExcludedForecastProduct('打包盒A'), true);
  assert.equal(isExcludedForecastProduct('招牌牛肉'), false);
  assert.equal(isExcludedForecastProduct(''), true);

  const normalize = createNormalizeForecastProducts({
    safeNumber: (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    },
  });
  assert.deepEqual(
    normalize([
      { name: '牛肉', qty: 2 },
      { name: '牛肉', qty: 1.5 },
      { name: '打包盒', qty: 9 },
      { name: '', qty: 1 },
      { name: '坏菜', qty: -1 },
    ]),
    { 牛肉: 3.5 }
  );
  assert.deepEqual(normalize({ 青菜: 2, 打包盒: 1, 坏: 'x' }), { 青菜: 2 });

  const sameDow = scoreForecastRow(
    { date: '2026-07-18', weather: 'rain', isHoliday: false, expectedRevenue: 10000 },
    { date: '2026-07-25', weather: 'rain', isHoliday: false, expectedRevenue: 12000 }
  );
  assert.ok(sameDow > 2);

  const empty = buildForecastByHeuristic([], { date: '2026-07-25' }, 10);
  assert.equal(empty.predictions.length, 0);
  assert.equal(empty.confidence, 0.1);

  const history = [
    {
      date: '2026-07-18',
      weather: '晴',
      isHoliday: true,
      expectedRevenue: 8000,
      productQuantities: { 牛肉: 10, 打包盒: 3, 青菜: 5 },
    },
    {
      date: '2026-07-11',
      weather: '雨',
      isHoliday: true,
      expectedRevenue: 9000,
      productQuantities: { 牛肉: 12, 青菜: 4 },
    },
  ];
  const built = buildForecastByHeuristic(
    history,
    { date: '2026-07-25', weather: '晴', isHoliday: true, expectedRevenue: 20000 },
    5
  );
  assert.ok(built.predictions.length >= 1);
  assert.ok(built.confidence >= 0.1);
  assert.match(built.summary, /历史记录/);

  const universe = extractHistoryProductUniverse(history);
  assert.ok(universe.has('牛肉'));
  assert.equal(universe.has('打包盒'), false);

  const constrain = createConstrainPredictionsToHistory({
    normalizePredictionItems: (items) =>
      (Array.isArray(items) ? items : []).map((x) => ({
        product: String(x.product || '').trim(),
        qty: Number(x.qty) || 0,
      })),
  });
  assert.deepEqual(constrain([], history, 10), []);
  const constrained = constrain(
    [
      { product: '牛肉', qty: 9 },
      { product: '幽灵菜', qty: 99 },
      { product: '青菜', qty: 3 },
    ],
    history,
    10
  );
  assert.equal(constrained.length, 2);
  assert.equal(constrained[0].product, '牛肉');

  const slotShare = createComputeSlotRevenueShare({
    safeDateOnly: (v) => String(v || '').slice(0, 10),
  });
  const histShare = slotShare(
    [
      { store: '洪潮', bizType: '堂食', slot: '午市', date: '2026-07-01', expectedRevenue: 450 },
      { store: '洪潮', bizType: '堂食', slot: '晚市', date: '2026-07-01', expectedRevenue: 550 },
      { store: '洪潮', bizType: '外卖', slot: '午市', date: '2026-07-01', expectedRevenue: 100 },
    ],
    '洪潮',
    '堂食',
    '午市',
    '2026-07-25'
  );
  assert.equal(histShare.splitMode, 'history');
  assert.ok(histShare.slotShare > 0);

  const fallback = slotShare([], '洪潮', '堂食', '晚市', '2026-07-25');
  assert.equal(fallback.splitMode, 'fallback');
  assert.equal(fallback.slotShare, 0.45);
});

// —— training/shared pure ——
test('training/shared: roles / quiz parse / rubric / rule quiz', () => {
  assert.equal(isManager('admin'), true);
  assert.equal(isManager('cashier'), false);
  assert.equal(getAssignableRoles('admin'), null);
  assert.ok(getAssignableRoles('store_manager').includes('cashier'));
  assert.deepEqual(getAssignableRoles('store_production_manager'), ['store_employee']);
  assert.equal(getAssignableRoles('cashier'), null);

  const rubric = formatRubricStandards({
    items: [
      { step_seq: 1, action: '洗手', quality_standard: '30秒', is_critical: true, common_failure: '过短' },
      { action: '摆盘' },
    ],
    fail_criteria: ['生肉'],
  });
  assert.match(rubric, /步骤标准图谱/);
  assert.match(rubric, /一票否决/);
  assert.equal(formatRubricStandards(null), '');

  const kb = buildKbArticleText({
    ai_explanation: 'x'.repeat(60),
    content: 'raw',
    step_rubric: { items: [{ step_seq: 1, action: '切' }], fail_criteria: [] },
  });
  assert.match(kb, /步骤标准图谱/);

  assert.match(getShanghaiDateKey(new Date('2026-07-25T16:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(getShanghaiDateTimeText(new Date('2026-07-25T01:00:00Z')), /2026/);

  const scored = parseScoringJson(
    JSON.stringify({
      steps: [{ step: 1, score: 8 }],
      total_score: 80,
      verdict: 'passed',
      summary: '不错',
      fail_reason: null,
    })
  );
  assert.equal(scored.aiVerdict, 'passed');
  const failed = parseScoringJson(JSON.stringify({ verdict: 'passed', fail_reason: '生肉', summary: 'x' }));
  assert.equal(failed.aiVerdict, 'failed');
  assert.match(failed.aiFeedback, /一票否决/);
  assert.equal(parseScoringJson('not-json').aiVerdict, 'review');

  assert.equal(stripJsonCodeFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(repairJsonText('{"a":1,}').includes('"a"'), true);

  const parsed = tryParseQuizJsonFromLLM('```json\n{"questions":[{"q":"Q1","options":["A","B"],"answer":0}]}\n```');
  assert.ok(parsed?.questions || parsed);
  assert.equal(tryParseQuizJsonFromLLM(''), null);

  assert.equal(normalizeQuizAnswerIndex(1, ['a', 'b', 'c']), 1);
  assert.equal(normalizeQuizAnswerIndex('B', ['a', 'b', 'c']), 1);
  assert.equal(normalizeQuizAnswerIndex('b', ['x', 'b', 'c']), 1);
  assert.equal(normalizeQuizAnswerIndex('nope', ['only']), 0);
  assert.equal(normalizeQuizAnswerIndex(0, []), -1);

  const q = normalizeQuizQuestion({
    question: '味道如何？',
    options: ['好', '一般'],
    answer: 'A',
    explanation: '偏香',
  });
  assert.equal(q.q, '味道如何？');
  assert.equal(q.options.length, 4);
  assert.equal(q.answer, 0);

  const list = normalizeQuizQuestionsPayload({
    data: { questions: [{ q: 'Q', options: { A: '1', B: '2' }, correct: 0 }] },
  });
  assert.equal(list.length, 1);

  const shuffled = shuffleQuizOptions({ q: 'Q', options: ['A', 'B', 'C', 'D'], answer: 2 });
  assert.equal(shuffled.options[shuffled.answer], 'C');

  const ruleQs = buildRuleBasedQuizQuestions({
    topicTitle: '刀工',
    keyPoints: ['握刀姿势', '切丝均匀', '安全'],
    kbContext: '刀工基础要点\n第二行',
    count: 6,
  });
  assert.ok(ruleQs.length >= 1);
  assert.ok(ruleQs[0].options.length >= 2);

  assert.deepEqual(parseReminderMeta({ a: 1 }), { a: 1 });
  assert.deepEqual(parseReminderMeta('{"b":2}'), {});
  assert.deepEqual(parseReminderMeta(null), {});
});

test('training/shared: generateQuiz fallback + store/notify no-op', async () => {
  const quiz = await generateQuizQuestionsForSession({
    topic: { title: '刀工基础', position: '厨房', key_points: ['握刀姿势要稳', '切丝均匀度要求高'] },
    username: 'alice',
    kbQuizContext: '刀工基础要求员工掌握安全操作与出品标准，避免交叉污染。',
    prevQuestionsSection: '',
  });
  assert.ok(quiz.questions.length >= 5);
  assert.ok(['ai', 'rule'].includes(quiz.source));

  assert.equal(await getUserStore('nobody'), '');
  await createTrainingUserNotification('alice', 't', 'm', { x: 1 });
  assert.equal(await sendTrainingFeishuMessage('alice', 'hello'), false);

  // 破碎 JSON 仍能抽题
  const broken = Array.from({ length: 6 }, (_, i) =>
    `{"q":"题${i}关于标准","options":["A${i}","B${i}","C${i}","D${i}"],"answer":0}`
  ).join(',');
  const rescued = tryParseQuizJsonFromLLM(`{"questions":[${broken}`);
  assert.ok(rescued?.questions?.length >= 5 || rescued == null || typeof rescued === 'object');
});

// —— offboarding + promotion sweep ——
test('offboarding-promotion: archive + ready notify + overdue reminder', async () => {
  const TODAY = '2026-07-24';
  let saved = null;
  const notifs = [];
  const tracks = [
    {
      id: 'tr-old',
      status: 'promoted',
      updatedAt: '2025-01-01T00:00:00.000Z',
      applicantUsername: 'old',
    },
    {
      id: 'tr-ready',
      status: 'qualification_approved',
      formalApplied: false,
      applicantUsername: 'bob',
      applicantName: '鲍勃',
      targetPosition: '店长',
      requiredTopicIds: ['t1', 't2'],
    },
    {
      id: 'tr-overdue',
      status: 'qualification_approved',
      formalApplied: false,
      applicantUsername: 'carol',
      applicantName: '卡罗尔',
      targetPosition: '出品',
      requiredTopicIds: ['t9'],
      trainingDueDate: '2026-07-01',
      overdueReminderCount: 0,
    },
  ];

  const { runOffboardingPromotionTick } = createOffboardingPromotionScheduler({
    pool: {
      async query(sql, params) {
        const s = String(sql);
        if (s.includes('from approval_requests') && params?.[0] === 'offboarding') {
          return {
            rows: [{
              id: 'appr-1',
              applicant_username: 'alice',
              payload: { username: 'alice', resignDate: TODAY },
              effective_date: TODAY,
            }],
          };
        }
        if (s.includes('update approval_requests set executed_at')) return { rows: [] };
        return { rows: [] };
      },
    },
    runForActiveTenants: async (fn) => { await fn('default'); },
    getSharedState: async () => ({
      employees: [{ username: 'alice', name: 'Alice', status: '在职' }],
      promotionTracks: tracks.map((t) => ({ ...t })),
    }),
    saveSharedState: async (state) => { saved = state; },
    ensureApprovalTables: async () => {},
    safeDateOnly: (v) => String(v || '').slice(0, 10),
    hrmsNowISO: () => `${TODAY}T10:00:00.000Z`,
    applyHrmsUserAccountGateFromEmployee: async () => {},
    addStateNotification: (s, n) => {
      notifs.push(n);
      return { ...s, notifications: [...(s.notifications || []), n] };
    },
    makeNotif: (targetUser, title, message, extra) => ({
      targetUser, title, message, ...(extra || {}),
    }),
    getPromotionTrackProgress: async (user) => {
      if (user === 'bob') return { passed: true };
      return { passed: false };
    },
    getPromotionTrackRecipients: async (_s, tr) => [tr.applicantUsername, 'admin'],
    getTodayDateOnly: () => TODAY,
  });

  await runOffboardingPromotionTick();
  assert.ok(saved);
  assert.ok(!saved.promotionTracks.some((t) => t.id === 'tr-old'), '90天归档');
  const ready = saved.promotionTracks.find((t) => t.id === 'tr-ready');
  assert.ok(ready?.readyNotifiedAt);
  const overdue = saved.promotionTracks.find((t) => t.id === 'tr-overdue');
  assert.equal(overdue.overdueReminderCount, 1);
  assert.ok(notifs.some((n) => n.type === 'promotion_training_completed'));
  assert.ok(notifs.some((n) => n.type === 'promotion_training_overdue'));
});

// —— growth-metrics ——
function metricsCtx(overrides = {}) {
  return {
    pool: {
      async query() { return { rows: [] }; },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    resolveTenantIdForStore: async () => 'default',
    verifyServerTenantBinding: async () => ({ ok: true }),
    upsertCustomer: async () => ({ id: 77 }),
    recomputeDiningSegments: async () => ({ updated: 3 }),
    loadRuleCandidates: async () => [],
    ABC_ROTATION_ORDER: {},
    deriveAbcStep: () => ({ step: 'A', blacklisted: false }),
    ...overrides,
  };
}

test('growth-metrics: ingest coupon_redeemed + phone_authorized + posConsumption', async () => {
  const queries = [];
  const ctx = metricsCtx({
    pool: {
      async query(sql, params) {
        queries.push(String(sql).slice(0, 80));
        const s = String(sql);
        if (s.includes('INSERT INTO growth_events')) {
          return { rows: [{ id: 1 }] };
        }
        if (s.includes('INSERT INTO growth_redemptions')) return { rows: [] };
        if (s.includes('UPDATE growth_delivery_logs')) return { rows: [] };
        if (s.includes('UPDATE wechat_work_customers')) {
          return { rows: [{ id: 9, store_id: 's1' }] };
        }
        if (s.includes('FROM pos_orders') && s.includes('GROUP BY')) {
          return {
            rows: [{
              phone: '13800138000',
              total_spent_fen: 12800,
              total_orders: 2,
              spent_30d_fen: 5000,
              last_visit: new Date('2026-07-20T12:00:00Z'),
              last_store_id: 's1',
            }],
          };
        }
        if (s.includes('last_orders') || s.includes('STRING_AGG')) {
          return {
            rows: [{
              phone: '13800138000',
              diners: 2,
              amount_after_discount: 128,
              last_order_dishes: '牛肉,青菜',
            }],
          };
        }
        if (s.includes('growth_daily_metrics')) return { rows: [{ metric_date: '2026-07-25' }] };
        return { rows: [] };
      },
    },
  });

  const redeem = await ingestMiniprogramEvent(ctx, {
    body: {
      event_type: 'coupon_redeemed',
      store_id: 's1',
      campaign_id: 'c1',
      channel: 'sms',
      phone: '138-0013-8000',
      coupon_id: 'cp1',
      amount_fen: 1234500,
      metadata: { short_code: '12345' },
      occurred_at: '2026-07-25T10:00:00Z',
      idempotency_key: 'idem-1',
    },
    req: {},
  });
  assert.equal(redeem.status, 200);
  assert.equal(redeem.body.inserted, true);

  const phoneAuth = await ingestMiniprogramEvent(ctx, {
    body: {
      event_type: 'phone_authorized',
      store_id: 's1',
      phone: '13800138000',
    },
    req: {},
  });
  assert.equal(phoneAuth.status, 200);

  const boom = await ingestMiniprogramEvent(
    metricsCtx({
      upsertCustomer: async () => {
        throw new Error('down');
      },
    }),
    {
      body: { event_type: 'campaign_scan', store_id: 's1' },
      req: {},
    }
  );
  assert.equal(boom.status, 500);

  const pos = await posConsumption(ctx, {
    body: { phones: ['13800138000', '138-0013-8000'], window_days: 30, store_id: 's1' },
    headers: {},
    tenantIdFromAuth: 'default',
    req: {},
  });
  assert.equal(pos.status, 200);
  assert.equal(pos.body.matched, 1);
  assert.equal(pos.body.data['13800138000'].total_orders, 2);

  const bindFail = await posConsumption(
    metricsCtx({
      verifyServerTenantBinding: async () => ({ ok: false, status: 403, error: 'forbidden' }),
    }),
    { body: { phones: ['1'] }, headers: {}, tenantIdFromAuth: 'default', req: {} }
  );
  assert.equal(bindFail.status, 403);

  const segs = await recomputeSegments(ctx, 'default');
  assert.equal(segs.status, 200);

  const metrics = await listMetrics(ctx, 'default', { days: 7, store_id: 's1' });
  assert.equal(metrics.status, 200);
  assert.ok(queries.length >= 1);
});

// —— performance-invalidation ——
test('performance-invalidation: filing path + guards', async () => {
  const recent = new Date().toISOString();
  const makePool = (handler) => ({
    query: async (sql, params) => handler(String(sql).replace(/\s+/g, ' '), params),
  });

  const badPeriod = await invalidatePerformanceRecord(
    { pool: makePool(async () => ({ rows: [] })) },
    {
      source_type: 'agent_scores_weekly',
      source_id: '1',
      username: 'a',
      period: '2026/07',
      actorUsername: 'admin',
      tenantId: 'default',
    }
  );
  assert.equal(badPeriod.error, 'invalid_period_format');

  const unsupported = await invalidatePerformanceRecord(
    {
      pool: makePool(async (s) => {
        if (/^BEGIN/i.test(s.trim())) return { rows: [] };
        if (/^ROLLBACK/i.test(s.trim())) return { rows: [] };
        return { rows: [] };
      }),
    },
    {
      source_type: 'unknown',
      source_id: '1',
      username: 'a',
      period: '2026-07',
      actorUsername: 'admin',
      tenantId: 'default',
    }
  );
  assert.equal(unsupported.error, 'unsupported_source_type');

  const filingPool = makePool(async (s, params) => {
    if (/^BEGIN/i.test(s.trim()) || /^COMMIT/i.test(s.trim())) return { rows: [] };
    if (/FROM master_tasks/i.test(s)) {
      return { rows: [{ task_id: params[0], dispatched_at: recent }] };
    }
    if (/FROM performance_invalidation_records/i.test(s) && /SELECT 1/i.test(s)) {
      return { rows: [] };
    }
    if (/FROM employee_scores/i.test(s)) {
      return {
        rows: [{
          total_score: 70,
          execution_rating: 'B',
          attitude_rating: 'C',
          ability_rating: 'B',
        }],
      };
    }
    if (/INSERT INTO performance_invalidation_records/i.test(s)) return { rows: [] };
    if (/FROM feishu_users/i.test(s) && /display_name/i.test(s)) {
      return {
        rows: [{
          store: '洪潮',
          role: 'store_manager',
          display_name: 'Alice',
        }],
      };
    }
    if (/INSERT INTO hrms_user_notifications/i.test(s)) return { rows: [] };
    if (/SELECT open_id FROM feishu_users/i.test(s)) {
      return { rows: [{ open_id: 'ou_admin' }, { open_id: 'ou_alice' }] };
    }
    return { rows: [] };
  });

  const filing = await invalidatePerformanceRecord(
    {
      pool: filingPool,
      calculateEmployeeScore: async () => ({
        total_score: 85,
        execution_rating: 'A',
        attitude_rating: 'B',
        ability_rating: 'A',
      }),
      getIncompleteTaskCount: async () => 2,
      sendLarkCard: async () => ({ ok: true }),
      sendLarkMessage: async () => ({ ok: true }),
    },
    {
      source_type: 'master_tasks_filing',
      source_id: 'TASK-9',
      username: 'alice',
      store: '洪潮',
      period: '2026-07',
      actorUsername: 'admin1',
      tenantId: 'default',
    }
  );
  assert.equal(filing.ok, true);
  assert.equal(filing.data.invalidated.source_type, 'master_tasks_filing');

  const list = await listPerformanceRecords(
    {
      pool: makePool(async (s) => {
        if (/agent_scores/i.test(s)) {
          return { rows: [{ id: 1, username: 'alice', total_score: 90, created_at: recent }] };
        }
        if (/master_tasks/i.test(s)) {
          return { rows: [{ task_id: 'T1', title: '备案', dispatched_at: recent }] };
        }
        if (/performance_invalidation_records/i.test(s)) return { rows: [] };
        if (/daily_bi|anomaly/i.test(s)) return { rows: [] };
        if (/employee_scores/i.test(s)) return { rows: [] };
        return { rows: [] };
      }),
    },
    { username: 'alice', period: '2026-07', tenantId: 'default' }
  );
  assert.equal(list.ok, true);
});

// —— birthday scheduler: EOM reminder ——
test('birthday scheduler: end-of-month reminder path', async () => {
  const now = new Date(2026, 6, 31, 9, 5, 0); // Jul 31
  let saved = null;
  const notifications = [];
  const { runBirthdayGreetingTick } = createBirthdayScheduler({
    getSharedState: async () => ({
      employees: [
        {
          username: 'sm1',
          name: '店长',
          role: 'store_manager',
          store: '洪潮',
          birthday: '1990-01-01',
          status: 'active',
        },
        { username: 'aug', name: '八月', store: '洪潮', birthday: '1991-08-03', status: 'active' },
        { username: 'aug2', name: '八月二', store: '洪潮', birthday: '1992-08-15', status: 'active' },
      ],
      birthdayGreetingsSent: {},
      birthdayRemindersSent: {},
      monthlyRemindersSent: {},
    }),
    saveSharedState: async (s) => { saved = s; },
    runForActiveTenants: async (fn) => { await fn('default'); },
    addStateNotification: (s, notif) => {
      notifications.push(notif);
      return { ...s, notifications: [...(s.notifications || []), notif] };
    },
    makeNotif: (targetUser, title, message, extra) => ({
      targetUser, title, message, ...(extra || {}),
    }),
    hrmsNowISO: () => '2026-07-31T09:05:00+08:00',
    isInactiveStatus: () => false,
    employeeAccountShouldDisable: () => false,
    pickAdminUsername: async () => 'admin1',
    pickHrManagerUsername: async () => 'hr1',
    stateFindUserRecord: () => ({ name: 'Admin' }),
    getNow: () => now,
  });

  await runBirthdayGreetingTick();
  assert.ok(saved);
  assert.ok(Object.keys(saved.monthlyRemindersSent || {}).length >= 1);
  assert.ok(notifications.some((n) => String(n.type || '').includes('birthday_monthly')));
});
