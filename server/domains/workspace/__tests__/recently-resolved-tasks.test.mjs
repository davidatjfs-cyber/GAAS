import test from 'node:test';
import assert from 'node:assert/strict';
import { getMyRecentlyResolvedTasks } from '../service.js';

// 2026-07-30：用户反馈"马己仙出品经理16:30收到试味定时任务，但工作台任务栏里根本没有"——
// 查证生产库真实事件日志发现这条任务确实真实创建、通过飞书卡片送达，责任人在飞书里17秒内
// 就回复提交了证据，系统自动审核通过直接resolved——resolved的任务立刻从"任务"tab消失，
// 责任人自己都没法回头确认"这件事到底有没有真的处理过"。锁定getMyRecentlyResolvedTasks()
// 只返回已解决状态且在时间窗口内的任务，大小写不敏感匹配用户名，同样走source白名单。

function makePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
}

test('getMyRecentlyResolvedTasks：只查resolved/pending_settlement/settled/closed状态', async () => {
  const pool = makePool();
  await getMyRecentlyResolvedTasks(pool, 'default', 'nnyxcs35');
  const sql = pool.calls[0].sql;
  assert.match(sql, /status IN \('resolved','pending_settlement','settled','closed'\)/);
  assert.doesNotMatch(sql, /'hr_filed'/, '已备案不算"完成"，不应该出现在这里');
});

test('getMyRecentlyResolvedTasks：大小写不敏感匹配用户名', async () => {
  const pool = makePool();
  await getMyRecentlyResolvedTasks(pool, 'default', 'NNYXCS35');
  assert.match(pool.calls[0].sql, /lower\(assignee_username\) = lower\(\$2\)/);
});

test('getMyRecentlyResolvedTasks：默认时间窗口是24小时，可通过hours参数调整，clamp在[1,168]', async () => {
  const pool = makePool();
  await getMyRecentlyResolvedTasks(pool, 'default', 'u');
  assert.equal(pool.calls[0].params[2], 24);

  const pool2 = makePool();
  await getMyRecentlyResolvedTasks(pool2, 'default', 'u', 999);
  assert.equal(pool2.calls[0].params[2], 168, '超过一周应该clamp到168小时');

  const pool3 = makePool();
  await getMyRecentlyResolvedTasks(pool3, 'default', 'u', 0);
  assert.equal(pool3.calls[0].params[2], 24, '0/无效值应该退回默认24小时');
});

test('getMyRecentlyResolvedTasks：走同一份source白名单，跟getMyOpenTasks一致', async () => {
  const pool = makePool();
  await getMyRecentlyResolvedTasks(pool, 'default', 'u');
  assert.match(pool.calls[0].sql, /source = ANY/);
  assert.ok(pool.calls[0].params[4].includes('scheduled_inspection'));
});
