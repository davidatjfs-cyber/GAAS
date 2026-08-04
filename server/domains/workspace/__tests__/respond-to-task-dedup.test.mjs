import test from 'node:test';
import assert from 'node:assert/strict';
import { respondToTask } from '../service.js';

// 2026-07-30：用户反馈同一条"任务已提交完成反馈，待确认"通知堆积了98条——根因是
// respondToTask 的 UPDATE 漏排除 pending_review 状态（第一次提交后任务已是该状态，
// 重复提交依然命中），且插入通知前没有去重检查。锁定：pending_review 状态下重复
// 提交必须被拒绝，且已有未读同类通知时不能再插入新的。
//
// 2026-08-04：原来的去重检查是"先 SELECT 查、再条件性 INSERT"两步分开执行，跟
// append.js 8/3 号之前的老 bug 是同一个 TOCTOU 竞态——生产实测同一 task_id 在
// 同一秒内插入了多条完全相同的通知。改成单条 INSERT...WHERE NOT EXISTS 原子完成。
// mock 相应升级为模拟一张假表，用同样的谓词（type/read_at/task_id/tenant_id）
// 判断这条 INSERT 是否真的会落地，而不是只数调用次数。

function makePool({ updateRows, existingNotifs = [] }) {
  const calls = [];
  const notifs = existingNotifs.slice();
  return {
    calls,
    notifs,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/UPDATE master_tasks/.test(sql)) return { rows: updateRows };
      if (/INSERT INTO hrms_user_notifications[\s\S]*WHERE NOT EXISTS/.test(sql)) {
        const [target, title, message, meta, tenantId, taskId] = params;
        const blocked = notifs.some(
          (n) =>
            n.type === 'task_response_submitted' &&
            n.readAt == null &&
            n.taskId === taskId &&
            n.tenantId === tenantId
        );
        if (!blocked) {
          notifs.push({ type: 'task_response_submitted', readAt: null, taskId, tenantId, target, title, message, meta });
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test('respondToTask：UPDATE必须排除pending_review状态，避免重复提交命中', async () => {
  const pool = makePool({ updateRows: [] });
  await respondToTask(pool, 'default', { taskId: 't1', username: 'nnyxwsb39', responseText: '测试' });
  const updateCall = pool.calls.find((c) => /UPDATE master_tasks/.test(c.sql));
  assert.match(updateCall.sql, /'pending_review'/, 'status排除列表里必须包含pending_review');
});

test('respondToTask：已存在未读同类通知时不再重复插入（原子 WHERE NOT EXISTS 判重）', async () => {
  const pool = makePool({
    updateRows: [{ task_id: 't1', store: '洪潮大宁久光店', title: '任务A', source_data: { promoted_by: 'nnyxyf26' } }],
    existingNotifs: [{ type: 'task_response_submitted', readAt: null, taskId: 't1', tenantId: 'default' }],
  });
  await respondToTask(pool, 'default', { taskId: 't1', username: 'nnyxwsb39', responseText: '测试' });
  // 查询本身一定会被发出（原子语句，判重在 SQL 内部完成），但假表里不应该多出一条
  const insertCall = pool.calls.find((c) => /INSERT INTO hrms_user_notifications/.test(c.sql));
  assert.ok(insertCall, '原子 INSERT 语句应该被发出（判重由 WHERE NOT EXISTS 完成，不是 JS 里 if 判断）');
  assert.equal(pool.notifs.length, 1, '已有未读同类通知时不应再次插入新行');
});

test('respondToTask：无重复通知时正常插入一条', async () => {
  const pool = makePool({
    updateRows: [{ task_id: 't1', store: '洪潮大宁久光店', title: '任务A', source_data: { promoted_by: 'nnyxyf26' } }],
    existingNotifs: [],
  });
  const result = await respondToTask(pool, 'default', { taskId: 't1', username: 'nnyxwsb39', responseText: '测试' });
  assert.equal(result.ok, true);
  assert.equal(pool.notifs.length, 1, '首次提交应该正常插入一条通知');
});
