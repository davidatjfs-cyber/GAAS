import test from 'node:test';
import assert from 'node:assert/strict';
import { getNotableOpenTasks, ackTask, resolveFoodSafetyTask } from '../service.js';

// 2026-07-30：用户明确要求"任务栏是要清空的队列，不是展示区"——食品安全cc视图是共享查询，
// 之前没有per-user状态记录"我已经确认收到过这条了"。这里锁定：① getNotableOpenTasks 传
// viewerUsername 时会排除该用户已经ackTask()过的任务；② ackTask 只插入per-user记录，不改
// master_tasks本身；③ resolveFoodSafetyTask 只有hq_manager/admin能调，且会真正把任务
// 状态改成resolved(对所有人都消失，不是per-user)。

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

test('getNotableOpenTasks 不传viewerUsername时不加ack过滤（向后兼容）', async () => {
  const pool = makePool();
  await getNotableOpenTasks(pool, 'default', 8);
  assert.doesNotMatch(pool.calls[0].sql, /master_task_acks/);
  assert.equal(pool.calls[0].params.length, 2);
});

test('getNotableOpenTasks 传viewerUsername时排除该用户已ack的任务', async () => {
  const pool = makePool();
  await getNotableOpenTasks(pool, 'default', 8, 'admin_a');
  assert.match(pool.calls[0].sql, /NOT EXISTS[\s\S]*master_task_acks/);
  assert.match(pool.calls[0].sql, /lower\(a\.username\) = lower\(\$3\)/);
  assert.equal(pool.calls[0].params[2], 'admin_a');
});

test('ackTask 插入一行per-user确认记录，ON CONFLICT DO NOTHING（可重复点击不报错）', async () => {
  const pool = makePool();
  const result = await ackTask(pool, 'default', 'WS-20260730-0001', 'admin_a');
  assert.equal(result.ok, true);
  assert.match(pool.calls[0].sql, /INSERT INTO master_task_acks/);
  assert.match(pool.calls[0].sql, /ON CONFLICT.*DO NOTHING/);
  assert.deepEqual(pool.calls[0].params, ['default', 'WS-20260730-0001', 'admin_a']);
});

test('ackTask 缺少taskId/username时报错，不落库', async () => {
  const pool = makePool();
  const result = await ackTask(pool, 'default', '', 'admin_a');
  assert.equal(result.ok, false);
  assert.equal(pool.calls.length, 0);
});

test('resolveFoodSafetyTask 非hq_manager/admin角色一律403，不执行UPDATE', async () => {
  const pool = makePool();
  const result = await resolveFoodSafetyTask(pool, 'default', {
    taskId: 'WS-1', reviewerUsername: 'someone', reviewerRole: 'store_manager', verdict: '扣分',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(pool.calls.length, 0);
});

test('resolveFoodSafetyTask 缺少判罚结果文本时报错', async () => {
  const pool = makePool();
  const result = await resolveFoodSafetyTask(pool, 'default', {
    taskId: 'WS-1', reviewerUsername: 'hq_a', reviewerRole: 'hq_manager', verdict: '  ',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
});

test('resolveFoodSafetyTask hq_manager输入判罚结果后把任务改成resolved（对所有人都消失，不是per-user)', async () => {
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: [{ task_id: 'WS-1' }] };
    },
  };
  const result = await resolveFoodSafetyTask(pool, 'default', {
    taskId: 'WS-1', reviewerUsername: 'hq_a', reviewerRole: 'hq_manager', verdict: '门店负责人扣绩效2分',
  });
  assert.equal(result.ok, true);
  assert.match(pool.calls[0].sql, /SET status = 'resolved'/);
  assert.match(pool.calls[0].sql, /food_safety/);
  const verdictParam = JSON.parse(pool.calls[0].params[0]);
  assert.equal(verdictParam.verdict, '门店负责人扣绩效2分');
});
