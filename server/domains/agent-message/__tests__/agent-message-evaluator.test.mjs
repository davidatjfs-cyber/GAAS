/**
 * chief_evaluator / train_advisor 上下文纯逻辑单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isChiefEvaluatorScoreQuery,
  buildVisibleEmployeeContext,
  formatChiefEvaluatorScoreReply,
  formatChiefEvaluatorNoScoreReply,
  tryHandleChiefEvaluatorScore,
  roleLabelZh,
} from '../evaluator-helpers.js';
import {
  formatKnowledgeBaseContext,
  formatTrainingTasksContext,
} from '../training-context.js';

test('isChiefEvaluatorScoreQuery', () => {
  assert.equal(isChiefEvaluatorScoreQuery('我的绩效多少'), true);
  assert.equal(isChiefEvaluatorScoreQuery('离职流程怎么走'), false);
});

test('buildVisibleEmployeeContext filters by role/store', () => {
  const emps = [
    { status: 'active', store: 'A', name: '甲', username: 'a', role: 'store_employee' },
    { status: 'active', store: 'B', name: '乙', username: 'b', role: 'store_manager' },
    { status: 'inactive', store: 'A', name: '丙', username: 'c', role: 'store_employee' },
  ];
  const storeOnly = buildVisibleEmployeeContext({
    employees: emps,
    senderRole: 'store_manager',
    store: 'A',
  });
  assert.ok(storeOnly.includes('甲'));
  assert.ok(!storeOnly.includes('乙'));
  assert.ok(!storeOnly.includes('丙'));

  const all = buildVisibleEmployeeContext({
    employees: emps,
    senderRole: 'admin',
    store: 'A',
  });
  assert.ok(all.includes('甲'));
  assert.ok(all.includes('乙'));
  assert.equal(roleLabelZh('store_manager'), '店长');
});

test('formatChiefEvaluatorScoreReply', () => {
  const text = formatChiefEvaluatorScoreReply('小王', {
    store: '洪潮店',
    brand: '洪潮',
    total_score: 88,
    summary: '表现良好',
    breakdown: { store_rating: 'A', execution_rating: 'B', attitude_rating: 'A', ability_rating: 'B' },
  });
  assert.ok(text.includes('小王'));
  assert.ok(text.includes('88'));
  assert.ok(text.includes('A级'));
  assert.ok(formatChiefEvaluatorNoScoreReply('小王').includes('暂无'));
});

test('tryHandleChiefEvaluatorScore', async () => {
  const miss = await tryHandleChiefEvaluatorScore(
    { query: async () => ({ rows: [] }) },
    { text: '离职怎么办', senderUsername: 'u1', senderName: 'U' }
  );
  assert.equal(miss.handled, false);

  const hit = await tryHandleChiefEvaluatorScore(
    {
      query: async () => ({
        rows: [{ store: 'S', brand: 'B', total_score: 90, breakdown: {}, summary: '' }],
      }),
    },
    { text: '查绩效', senderUsername: 'u1', senderName: 'U' }
  );
  assert.equal(hit.handled, true);
  assert.ok(hit.response.includes('90'));
});

test('formatKnowledgeBaseContext / formatTrainingTasksContext', () => {
  assert.equal(formatKnowledgeBaseContext([]), '');
  const kb = formatKnowledgeBaseContext([{ title: 'SOP1', content: 'x'.repeat(400) }]);
  assert.ok(kb.includes('SOP1'));
  assert.ok(kb.includes('...'));
  assert.ok(kb.length < 400);

  const tasks = formatTrainingTasksContext(
    [{ task_id: 'T1', title: '课', type: 'sop', status: 'pending', due_date: '2026-01-15' }],
    { formatDueDate: () => '2026/1/15' }
  );
  assert.ok(tasks.includes('T1'));
  assert.ok(tasks.includes('2026/1/15'));
});
