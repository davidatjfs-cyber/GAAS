import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestAssignees,
  getOpenRound,
  getClosedRounds,
  saveQueryHistory,
  fetchRecentComplaints,
  fetchTurnoverSnapshot,
  buildPlan,
} from '../rounds-io.js';

function mockPool(handlers) {
  let callIndex = 0;
  return () => ({
    query: async (sql, params) => {
      const handler = handlers[callIndex];
      callIndex += 1;
      if (typeof handler === 'function') return handler(sql, params);
      if (handler) return handler;
      throw new Error(`unexpected query #${callIndex}: ${String(sql).slice(0, 80)}`);
    },
  });
}

test('suggestAssignees sorts by ROLE_POSITIONS priority for store_manager', async () => {
  const getPool = mockPool([
    {
      rows: [
        { username: 'u1', name: '主管甲', position: '前厅主管' },
        { username: 'u2', name: '店长乙', position: '店长' },
        { username: 'u3', name: '经理丙', position: '前厅经理' },
      ],
    },
  ]);
  const out = await suggestAssignees(getPool, '马己仙旗舰店', 'store_manager');
  assert.deepEqual(out.map((r) => r.username), ['u2', 'u1', 'u3']);
});

test('suggestAssignees falls back to store_manager positions for unknown role', async () => {
  const getPool = mockPool([
    {
      rows: [{ username: 'u1', name: '店长', position: '店长' }],
    },
  ]);
  const out = await suggestAssignees(getPool, '洪潮店', 'unknown_role');
  assert.equal(out.length, 1);
  assert.equal(out[0].username, 'u1');
});

test('getOpenRound returns round with tasks attached', async () => {
  const getPool = mockPool([
    { rows: [{ id: 10, store: '洪潮店', problem_key: 'revenue', status: 'active' }] },
    { rows: [{ id: 101, title: '任务A', status: 'pending' }] },
  ]);
  const round = await getOpenRound(getPool, '洪潮店', 'revenue');
  assert.equal(round.id, 10);
  assert.equal(round.tasks.length, 1);
  assert.equal(round.tasks[0].title, '任务A');
});

test('getOpenRound returns null when no open round', async () => {
  const getPool = mockPool([{ rows: [] }]);
  const round = await getOpenRound(getPool, '洪潮店', 'revenue');
  assert.equal(round, null);
});

test('getClosedRounds returns closed rounds ordered by round_no', async () => {
  const getPool = mockPool([
    {
      rows: [
        { id: 1, round_no: 1, status: 'closed' },
        { id: 2, round_no: 2, status: 'closed' },
      ],
    },
  ]);
  const rows = await getClosedRounds(getPool, '洪潮店', 'revenue');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].round_no, 1);
});

test('saveQueryHistory inserts title/mode only payload', async () => {
  let inserted;
  const getPool = mockPool([
    (sql, params) => {
      assert.match(sql, /INSERT INTO growth_custom_query_history/);
      inserted = params;
      return { rows: [] };
    },
  ]);
  await saveQueryHistory(
    getPool,
    { error: () => {} },
    null,
    '洪潮店',
    '人效差',
    { title: '人效分析', mode: 'existing', big: 'ignored' },
    'admin'
  );
  assert.equal(inserted[0], 'default');
  assert.equal(inserted[1], '洪潮店');
  assert.equal(inserted[2], '人效差');
  assert.deepEqual(JSON.parse(inserted[3]), { title: '人效分析', mode: 'existing' });
  assert.equal(inserted[4], 'admin');
});

test('saveQueryHistory logs error and does not throw on insert failure', async () => {
  const errors = [];
  const getPool = mockPool([
    async () => {
      throw new Error('db down');
    },
  ]);
  await saveQueryHistory(
    getPool,
    { error: (p) => errors.push(p) },
    't1',
    '洪潮店',
    'q',
    { title: 't' },
    null
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].msg, 'save_query_history_failed');
  assert.match(errors[0].err, /db down/);
});

test('fetchRecentComplaints returns rows from agent_messages', async () => {
  const getPool = mockPool([
    {
      rows: [{ date: '2026-07-01', reason: '上菜慢', product: null, rating: '2', platform: 'dp' }],
    },
  ]);
  const rows = await fetchRecentComplaints(getPool, '马己仙店', 14);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, '上菜慢');
});

test('fetchTurnoverSnapshot maps active/left/total with empty-row defaults', async () => {
  const getPool = mockPool([{ rows: [] }]);
  const snap = await fetchTurnoverSnapshot(getPool, '洪潮店');
  assert.deepEqual(snap, { active: 0, left: 0, total: 0 });
});

test('fetchTurnoverSnapshot parses numeric counts', async () => {
  const getPool = mockPool([{ rows: [{ active: '12', left_count: '3', total: '15' }] }]);
  const snap = await fetchTurnoverSnapshot(getPool, '洪潮店');
  assert.deepEqual(snap, { active: 12, left: 3, total: 15 });
});

test('buildPlan enriches descriptions from currentDetail and attaches assignees', async () => {
  const getPool = mockPool([
    {
      rows: [
        {
          code: 'assign_cert_training',
          title: '指派培训',
          description: '批量指派',
          assignee_role: 'production_manager',
          phase: '第2周',
          sort: 1,
          why: '技能缺口',
          acceptance_criteria: '完成率≥70%',
        },
        {
          code: 'launch_recall_campaign',
          title: '召回',
          description: '沉睡召回',
          assignee_role: 'store_manager',
          phase: '第1周',
          sort: 2,
          why: null,
          acceptance_criteria: null,
        },
        {
          code: 'complete_cost_library',
          title: '成本库',
          description: '补成本',
          assignee_role: 'production_manager',
          phase: '第1周',
          sort: 3,
          why: '',
          acceptance_criteria: '',
        },
        {
          code: 'review_complaint_dishes',
          title: '投诉菜',
          description: '审核',
          assignee_role: 'production_manager',
          phase: '第1周',
          sort: 4,
          why: 'w',
          acceptance_criteria: 'a',
        },
        {
          code: 'other',
          title: '其它',
          description: null,
          assignee_role: 'store_manager',
          phase: '',
          sort: 5,
          why: '',
          acceptance_criteria: '',
        },
      ],
    },
    // suggestAssignees × 5
    { rows: [{ username: 'pm', name: '出品', position: '出品经理' }] },
    { rows: [{ username: 'sm', name: '店长', position: '店长' }] },
    { rows: [{ username: 'pm2', name: '出品2', position: '出品经理' }] },
    { rows: [{ username: 'pm3', name: '出品3', position: '出品经理' }] },
    { rows: [] },
  ]);
  const plan = await buildPlan(getPool, '洪潮店', 'staff_efficiency', {
    gap_count: 4,
    sleeping_customers: 10,
    sleeping_high: 7,
    sleeping_medium: 3,
    unmatched_dishes: 5,
    complaint_dishes: [
      { dish: '叉烧', count: 3 },
      { dish: '烧鹅', count: 2 },
    ],
  });
  assert.equal(plan.length, 5);
  assert.match(plan[0].description, /认证缺口/);
  assert.match(plan[1].description, /沉睡池 10/);
  assert.match(plan[2].description, /缺成本/);
  assert.match(plan[3].description, /高投诉:叉烧\(3次\)、烧鹅\(2次\)/);
  assert.equal(plan[4].description, '');
  assert.equal(plan[0].default_assignee.username, 'pm');
  assert.equal(plan[4].default_assignee, null);
  assert.equal(plan[1].why, '');
  assert.equal(plan[1].acceptance_criteria, '');
});

test('buildPlan skips enrichment when detail counters are zero/empty', async () => {
  const getPool = mockPool([
    {
      rows: [
        {
          code: 'assign_cert_training',
          title: '指派培训',
          description: '批量指派',
          assignee_role: 'store_manager',
          phase: '第1周',
          sort: 1,
          why: 'y',
          acceptance_criteria: 'c',
        },
        {
          code: 'review_complaint_dishes',
          title: '投诉菜',
          description: '审核',
          assignee_role: 'store_manager',
          phase: '第1周',
          sort: 2,
          why: '',
          acceptance_criteria: '',
        },
      ],
    },
    { rows: [{ username: 'sm', name: '店长', position: '店长' }] },
    { rows: [{ username: 'sm', name: '店长', position: '店长' }] },
  ]);
  const plan = await buildPlan(getPool, '洪潮店', 'menu_optimization', {
    gap_count: 0,
    sleeping_customers: 0,
    unmatched_dishes: 0,
    complaint_dishes: [],
  });
  assert.equal(plan[0].description, '批量指派');
  assert.equal(plan[1].description, '审核');
});
