/**
 * domains/master-agent 纯逻辑单测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTaskSourceData,
  pickAssigneeForCategory,
  MASTER_TASK_PM_EXCLUSIVE_CATEGORIES,
  MASTER_TASK_SM_EXCLUSIVE_CATEGORIES,
} from '../resolve-assignee.js';
import {
  parseLlmValidReview,
  buildVisionReviewPrompt,
  buildTextReviewSystemPrompt,
  formatSopContext,
  decideReviewOutcome,
  buildReviewNotificationMessage,
  buildReviewResultPayload,
} from '../ops-review-helpers.js';
import {
  exportCsv,
  summarizeEvidenceExport,
  buildMasterEvidenceCsv,
} from '../route-helpers.js';
import { createTenantScopedTick } from '../scheduler.js';

const sampleState = {
  employees: [
    { username: 'pm1', name: '出品经理A', role: 'store_production_manager', store: '洪潮 大宁' },
    { username: 'sm1', name: '店长B', role: 'store_manager', store: '洪潮大宁' },
    { username: 'sm2', name: '店长C', role: 'store_manager', store: '马己仙' },
  ],
};

const roleMap = {
  产品差评异常: 'store_production_manager',
  服务差评异常: 'store_manager',
};

test('normalizeTaskSourceData：对象/JSON 字符串/非法串', () => {
  assert.deepEqual(normalizeTaskSourceData({ a: 1 }), { a: 1 });
  assert.deepEqual(normalizeTaskSourceData('{"_auditee_role":"store_manager"}'), {
    _auditee_role: 'store_manager',
  });
  assert.deepEqual(normalizeTaskSourceData('not-json'), {});
  assert.deepEqual(normalizeTaskSourceData(null), {});
});

test('pickAssigneeForCategory：岗位锁定类目不跨岗降级', () => {
  assert(MASTER_TASK_PM_EXCLUSIVE_CATEGORIES.has('产品差评异常'));
  assert(MASTER_TASK_SM_EXCLUSIVE_CATEGORIES.has('服务差评异常'));

  const pmOnly = pickAssigneeForCategory({
    category: '产品差评异常',
    store: '洪潮大宁',
    existingAssignee: null,
    sourceData: {},
    state: { employees: [{ username: 'sm1', name: '店长', role: 'store_manager', store: '洪潮大宁' }] },
    roleMap,
  });
  assert.equal(pmOnly.assignee, null);
  assert.ok(pmOnly.warnings.some((w) => w.startsWith('no_match:')));

  const smOnly = pickAssigneeForCategory({
    category: '服务差评异常',
    store: '洪潮大宁',
    existingAssignee: null,
    sourceData: {},
    state: {
      employees: [
        { username: 'pm1', name: '出品', role: 'store_production_manager', store: '洪潮大宁' },
      ],
    },
    roleMap,
  });
  assert.equal(smOnly.assignee, null);
});

test('pickAssigneeForCategory：匹配出品经理与人效 auditee 角色', () => {
  const hit = pickAssigneeForCategory({
    category: '产品差评异常',
    store: '洪潮 大宁',
    existingAssignee: null,
    sourceData: {},
    state: sampleState,
    roleMap,
  });
  assert.equal(hit.assignee?.username, 'pm1');

  const labor = pickAssigneeForCategory({
    category: '人效值异常',
    store: '洪潮大宁',
    existingAssignee: null,
    sourceData: { _auditee_role: 'store_manager' },
    state: sampleState,
    roleMap: {},
  });
  assert.equal(labor.assignee?.username, 'sm1');
});

test('pickAssigneeForCategory：跨门店 existingAssignee 触发 warning 并重匹配', () => {
  const r = pickAssigneeForCategory({
    category: '充值异常',
    store: '洪潮大宁',
    existingAssignee: 'sm2',
    sourceData: {},
    state: sampleState,
    roleMap: { 充值异常: 'store_manager' },
  });
  assert.ok(r.warnings.some((w) => w.startsWith('cross_store:sm2')));
  assert.equal(r.assignee?.username, 'sm1');
});

test('parseLlmValidReview：JSON 与启发式回退', () => {
  const ok = parseLlmValidReview('```json\n{"valid":true,"reason":"ok"}\n```');
  assert.equal(ok.valid, true);
  assert.equal(ok.reason, 'ok');

  const bad = parseLlmValidReview('回复无效，不够详细');
  assert.equal(bad.valid, false);
  assert.equal(bad.heuristic, true);
});

test('decideReviewOutcome 与审核通知文案', () => {
  assert.equal(decideReviewOutcome(true, true), 'resolved');
  assert.equal(decideReviewOutcome(true, false), 'rejected');

  const msg = buildReviewNotificationMessage({
    task: { task_id: 'MT-1' },
    reviewDecision: 'rejected',
    imageReviewOk: false,
    textReviewOk: true,
    reviewNotes: '照片模糊',
    responseImages: [1],
    responseText: '已整改',
  });
  assert.match(msg, /MT-1/);
  assert.match(msg, /未通过/);
  assert.match(msg, /照片不符合要求/);

  const payload = buildReviewResultPayload({
    reviewDecision: 'resolved',
    imageReviewOk: true,
    textReviewOk: true,
    reviewNotes: 'ok',
  });
  assert.equal(payload.review_result.decision, 'resolved');
  assert.ok(payload.review_result.reviewedAt);
});

test('buildVisionReviewPrompt / buildTextReviewSystemPrompt / formatSopContext', () => {
  const vp = buildVisionReviewPrompt({ title: '整改冰箱' });
  assert.match(vp, /整改冰箱/);

  const sp = buildTextReviewSystemPrompt({ title: 'T', detail: 'D' }, '\n\nSOP');
  assert.match(sp, /异常问题：T/);
  assert.match(sp, /SOP/);

  assert.equal(formatSopContext([]), '');
  assert.match(formatSopContext([{ title: 'S1', content: '内容' }]), /S1/);
});

test('route-helpers：CSV 转义与证据汇总', () => {
  const csv = exportCsv([{ a: 'x,y', b: 1 }], ['a', 'b']);
  assert.match(csv, /"x,y"/);

  const { byStatus, byEventType } = summarizeEvidenceExport(
    [{ status: 'open' }, { status: 'open' }],
    [{ event_type: 'status_change' }]
  );
  assert.equal(byStatus.open, 2);
  assert.equal(byEventType.status_change, 1);

  const bundle = buildMasterEvidenceCsv([{ task_id: 'T1' }], [{ task_id: 'T1', event_type: 'x' }]);
  assert.match(bundle, /# master_tasks/);
  assert.match(bundle, /T1/);
});

test('createTenantScopedTick：多租户包装与日志条件', async () => {
  const logs = [];
  const errors = [];
  const tenantTick = createTenantScopedTick({
    pool: () => ({}),
    getActiveTenantIds: async () => ['default', 't2'],
    tenantContext: { run: async (_id, fn) => fn() },
    log: {
      info: (...args) => logs.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    },
  });

  let calls = 0;
  const tick = tenantTick('Test', async () => {
    calls += 1;
    return calls === 1 ? 2 : 0;
  });

  await tick();
  assert.equal(calls, 2);
  assert.ok(logs.some((l) => l.includes('Test(default)')));
  assert.ok(logs.some((l) => l.includes('2')));
});
