import test from 'node:test';
import assert from 'node:assert/strict';
import { getWorkspaceHome } from '../service.js';

// 2026-07-30：业务方确认的任务路由规则——只有食品安全类任务需要抄送总部经理/管理员，
// 其余全部只归当事人(assignee_username)。这里锁定：非食安cc角色只看自己的任务，
// admin/hq_manager 额外能看到食安cc任务（且不重复），别的角色即使传角色也拿不到cc视图。

function makePool({ myRows = [], ccRows = [] } = {}) {
  return {
    async query(sql) {
      if (/status = 'pending_review'/.test(sql)) return { rows: [] };
      // 注意：getMyOpenTasks 的 SQL 里也含 "food_safety" 字样（它的 OR 子句里有），
      // 必须先判断 assignee_username 再判断 food_safety，否则会把 getMyOpenTasks
      // 误判成 getNotableOpenTasks 的查询。
      if (/assignee_username = \$2/.test(sql)) return { rows: myRows };
      if (/food_safety/.test(sql)) return { rows: ccRows };
      if (/select data from hrms_state/.test(sql)) return { rows: [{ data: { stores: [] } }] };
      if (/store_ratings/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}

test('store_manager 只看自己的任务，看不到其它人的食安任务', async () => {
  const pool = makePool({
    myRows: [{ task_id: 'my-1', title: '我的任务' }],
    ccRows: [{ task_id: 'fs-1', title: '食安异常' }],
  });
  const data = await getWorkspaceHome(pool, 'default', 'store_manager_a', { role: 'store_manager' });
  const ids = data.myTasks.map((t) => t.task_id);
  assert.deepEqual(ids, ['my-1']);
});

test('admin 能看到自己的任务 + 食安cc任务，两者不重复', async () => {
  const pool = makePool({
    myRows: [{ task_id: 'my-1', title: '我的任务' }],
    ccRows: [{ task_id: 'fs-1', title: '食安异常A' }, { task_id: 'fs-2', title: '食安异常B' }],
  });
  const data = await getWorkspaceHome(pool, 'default', 'admin_a', { role: 'admin' });
  const ids = data.myTasks.map((t) => t.task_id).sort();
  assert.deepEqual(ids, ['fs-1', 'fs-2', 'my-1']);
});

test('admin 自己就是某条食安任务的责任人时，cc视图不会把它重复拼一次', async () => {
  const pool = makePool({
    myRows: [{ task_id: 'fs-1', title: '食安异常（我是责任人）' }],
    ccRows: [{ task_id: 'fs-1', title: '食安异常（我是责任人）' }],
  });
  const data = await getWorkspaceHome(pool, 'default', 'admin_a', { role: 'admin' });
  const ids = data.myTasks.map((t) => t.task_id);
  assert.deepEqual(ids, ['fs-1']);
});

test('hq_manager 也能看到食安cc视图，普通 store_manager 不能', async () => {
  const pool = makePool({ myRows: [], ccRows: [{ task_id: 'fs-1' }] });
  const hq = await getWorkspaceHome(pool, 'default', 'hq_a', { role: 'hq_manager' });
  assert.deepEqual(hq.myTasks.map((t) => t.task_id), ['fs-1']);
  const sm = await getWorkspaceHome(pool, 'default', 'sm_a', { role: 'store_manager' });
  assert.deepEqual(sm.myTasks.map((t) => t.task_id), []);
});
