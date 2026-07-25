/**
 * domains/agent-message/training-flow.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tryHandleTrainingFlows } from '../domains/agent-message/training-flow.js';

function makePool(handler) {
  const sqls = [];
  return {
    sqls,
    async query(sql, params) {
      sqls.push({ sql: String(sql), params });
      return handler(String(sql), params);
    },
  };
}

test('approval：无 pending → 继续；有 pending → 更新并 handled', async () => {
  const empty = makePool(() => ({ rows: [] }));
  let r = await tryHandleTrainingFlows(empty, {
    text: '审核通过并下发',
    senderRole: 'admin',
    senderUsername: 'a',
    route: 'general',
  });
  assert.equal(r.handled, false);

  const pool = makePool((sql) => {
    if (sql.includes('pending_approval')) {
      return { rows: [{ id: 9, title: '课A', assignee_username: 'bob' }] };
    }
    return { rows: [] };
  });
  r = await tryHandleTrainingFlows(pool, {
    text: '审核通过并下发',
    senderRole: 'hr_manager',
    senderUsername: 'hr',
    route: 'general',
  });
  assert.equal(r.handled, true);
  assert.match(r.response, /课A/);
  assert.ok(pool.sqls.some((q) => /UPDATE training_tasks/.test(q.sql)));
});

test('exam start：无任务 false；有 in_progress 返回题目', async () => {
  const empty = makePool(() => ({ rows: [] }));
  let r = await tryHandleTrainingFlows(empty, {
    text: '开始考核',
    senderRole: 'store_employee',
    senderUsername: 'u1',
    route: 'train_advisor',
  });
  assert.equal(r.handled, false);

  const pool = makePool(() => ({
    rows: [{ id: 1, title: '消防课' }],
  }));
  r = await tryHandleTrainingFlows(pool, {
    text: '培训考核',
    senderRole: 'store_employee',
    senderUsername: 'u1',
    route: 'train_advisor',
  });
  assert.equal(r.handled, true);
  assert.match(r.response, /消防课/);
  assert.match(r.response, /三个实操要点/);
});

test('exam answer：未通过 / 通过写 exam_results+master_tasks', async () => {
  const task = { id: 3, title: '卫生课', store: 'S1', brand: 'B1' };
  const failPool = makePool((sql) => {
    if (sql.includes('in_progress')) return { rows: [task] };
    return { rows: [] };
  });
  let r = await tryHandleTrainingFlows(failPool, {
    text: '1. 短\n2. 答',
    senderRole: 'store_employee',
    senderUsername: 'u1',
    route: 'train_advisor',
  });
  assert.equal(r.handled, true);
  assert.match(r.response, /未通过/);

  const okPool = makePool((sql) => {
    if (sql.includes('in_progress')) return { rows: [task] };
    return { rows: [] };
  });
  const long =
    '1. 这是足够长的第一题回答内容用来过关\n2. 这是足够长的第二题结合场景回答';
  r = await tryHandleTrainingFlows(okPool, {
    text: long,
    senderRole: 'store_employee',
    senderUsername: 'u1',
    route: 'train_advisor',
  });
  assert.equal(r.handled, true);
  assert.match(r.response, /考核通过/);
  assert.ok(okPool.sqls.some((q) => /exam_results/.test(q.sql)));
  assert.ok(okPool.sqls.some((q) => /master_tasks/.test(q.sql)));
  assert.ok(okPool.sqls.some((q) => /status = 'completed'/.test(q.sql)));
});

test('无关文本 → handled false', async () => {
  const r = await tryHandleTrainingFlows(makePool(() => ({ rows: [] })), {
    text: '你好',
    senderRole: 'admin',
    senderUsername: 'a',
    route: 'general',
  });
  assert.equal(r.handled, false);
});
