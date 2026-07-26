/**
 * sync-issues + task-response unit tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySkippedAuditorIssue } from '../sync-issues-helpers.js';
import { createSyncDataAuditorIssues } from '../sync-issues.js';
import {
  buildTaskResponseAck,
  findPendingResponseTask,
  hasTaskReplyKeyword,
} from '../task-response-lookup.js';
import { createHandleTaskResponse } from '../task-response.js';

function queuePool(handlers) {
  let i = 0;
  return {
    query: async (sql, params) => {
      const next = handlers[i++];
      if (!next) throw new Error(`unexpected query #${i}: ${String(sql).slice(0, 80)}`);
      if (typeof next === 'function') return next(sql, params);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('classifySkippedAuditorIssue covers legacy BI + material', () => {
  assert.equal(classifySkippedAuditorIssue({ category: '实收营收异常-涨跌' }), 'legacy_bi');
  assert.equal(classifySkippedAuditorIssue({ category: '原料收货抽检' }), 'material');
  assert.equal(classifySkippedAuditorIssue({ title: '近 7 天有原料异常反馈' }), 'material');
  assert.equal(classifySkippedAuditorIssue({ category: '巡检', title: '桌面脏' }), null);
});

test('hasTaskReplyKeyword + buildTaskResponseAck', () => {
  assert.equal(hasTaskReplyKeyword('已处理完毕'), true);
  assert.equal(hasTaskReplyKeyword('随便聊聊'), false);
  const ack = buildTaskResponseAck(
    { task_id: 'MT-1', title: '修灯' },
    'x'.repeat(120),
    ['a.jpg']
  );
  assert.equal(ack.handled, true);
  assert.equal(ack.taskId, 'MT-1');
  assert.match(ack.response, /MT-1/);
  assert.match(ack.response, /\.\.\./);
  assert.match(ack.response, /1张/);
});

test('findPendingResponseTask: parent id exact then fallback', async () => {
  const logs = [];
  const pool = queuePool([
    { rows: [] },
    { rows: [{ task_id: 'MT-2', title: 't' }] },
  ]);
  const task = await findPendingResponseTask(pool, {
    username: 'u1',
    parentMessageId: 'msg-1',
    log: { info: (...a) => logs.push(a.join(' ')) },
  });
  assert.equal(task.task_id, 'MT-2');
  assert.ok(logs.some((l) => l.includes('fallback')));
});

test('findPendingResponseTask: keyword path without parent', async () => {
  const pool = queuePool([{ rows: [{ task_id: 'MT-3' }] }]);
  const task = await findPendingResponseTask(pool, {
    username: 'u1',
    text: '已整改',
    imageUrls: [],
  });
  assert.equal(task.task_id, 'MT-3');
  assert.equal(await findPendingResponseTask(queuePool([]), { username: 'u1', text: 'hi' }), null);
});

test('createSyncDataAuditorIssues skips + creates', async () => {
  const created = [];
  const logs = { info: [], error: [] };
  const poolObj = queuePool([
    { rows: [{ id: '1', category: '实收营收异常', title: 'x' }] },
    { rows: [{ id: '1b', category: '原料收货', title: '原料' }] },
    { rows: [{ id: '2', category: '巡检', title: '灯坏', severity: 'high', store: 's', brand: 'b', detail: 'd', data: {} }] },
    { rows: [] },
    new Error('boom'),
  ]);
  const sync = createSyncDataAuditorIssues({
    pool: () => poolObj,
    log: {
      info: (...a) => logs.info.push(a.join(' ')),
      error: (...a) => logs.error.push(a.join(' ')),
    },
    createTask: async (payload, tenantId) => {
      created.push({ payload, tenantId });
      return 'MT-9';
    },
  });
  assert.equal(await sync([]), 0);
  assert.equal(await sync(['1', '1b', '2', '3'], 't1'), 1);
  assert.equal(created.length, 1);
  assert.equal(created[0].payload.sourceRef, '2');
  assert.ok(logs.info.some((l) => l.includes('skip deprecated anomaly')));
  assert.ok(logs.info.some((l) => l.includes('skip deprecated material')));
  assert.ok(logs.error.some((l) => l.includes('Failed to sync')));
});

test('createHandleTaskResponse transitions and acks', async () => {
  const poolObj = queuePool([
    { rows: [{ task_id: 'MT-5', title: '修门' }] },
  ]);
  const handle = createHandleTaskResponse({
    pool: () => poolObj,
    log: { info() {}, error() {} },
    transitionTask: async (taskId, status) => {
      assert.equal(taskId, 'MT-5');
      assert.equal(status, 'pending_review');
      return true;
    },
  });
  const r = await handle('alice', '已处理', [], 'pm1');
  assert.equal(r.handled, true);
  assert.equal(r.taskId, 'MT-5');
});

test('createHandleTaskResponse returns null on miss/error', async () => {
  const handleMiss = createHandleTaskResponse({
    pool: () => queuePool([]),
    log: { info() {}, error() {} },
    transitionTask: async () => true,
  });
  assert.equal(await handleMiss('u', 'hi', []), null);

  const handleErr = createHandleTaskResponse({
    pool: () => ({
      query: async () => { throw new Error('db'); },
    }),
    log: { info() {}, error() {} },
    transitionTask: async () => true,
  });
  assert.equal(await handleErr('u', '已处理', ['i.jpg']), null);
});
