import test from 'node:test';
import assert from 'node:assert/strict';
import { respondToTask } from '../service.js';

// 2026-07-30：用户反馈同一条"任务已提交完成反馈，待确认"通知堆积了98条——根因是
// respondToTask 的 UPDATE 漏排除 pending_review 状态（第一次提交后任务已是该状态，
// 重复提交依然命中），且插入通知前没有去重检查。锁定：pending_review 状态下重复
// 提交必须被拒绝，且已有未读同类通知时不能再插入新的。

function makePool({ updateRows, dupExists }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/UPDATE master_tasks/.test(sql)) return { rows: updateRows };
      if (/SELECT 1 FROM hrms_user_notifications/.test(sql)) return { rows: dupExists ? [{}] : [] };
      if (/INSERT INTO hrms_user_notifications/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

test('respondToTask：UPDATE必须排除pending_review状态，避免重复提交命中', async () => {
  const pool = makePool({ updateRows: [], dupExists: false });
  await respondToTask(pool, 'default', { taskId: 't1', username: 'nnyxwsb39', responseText: '测试' });
  const updateCall = pool.calls.find((c) => /UPDATE master_tasks/.test(c.sql));
  assert.match(updateCall.sql, /'pending_review'/, 'status排除列表里必须包含pending_review');
});

test('respondToTask：已存在未读同类通知时不再重复插入', async () => {
  const pool = makePool({
    updateRows: [{ task_id: 't1', store: '洪潮大宁久光店', title: '任务A', source_data: { promoted_by: 'nnyxyf26' } }],
    dupExists: true,
  });
  await respondToTask(pool, 'default', { taskId: 't1', username: 'nnyxwsb39', responseText: '测试' });
  const insertCall = pool.calls.find((c) => /INSERT INTO hrms_user_notifications/.test(c.sql));
  assert.equal(insertCall, undefined, '已有未读同类通知时不应再次INSERT');
});

test('respondToTask：无重复通知时正常插入一条', async () => {
  const pool = makePool({
    updateRows: [{ task_id: 't1', store: '洪潮大宁久光店', title: '任务A', source_data: { promoted_by: 'nnyxyf26' } }],
    dupExists: false,
  });
  const result = await respondToTask(pool, 'default', { taskId: 't1', username: 'nnyxwsb39', responseText: '测试' });
  assert.equal(result.ok, true);
  const insertCall = pool.calls.find((c) => /INSERT INTO hrms_user_notifications/.test(c.sql));
  assert.ok(insertCall, '首次提交应该正常插入通知');
});
