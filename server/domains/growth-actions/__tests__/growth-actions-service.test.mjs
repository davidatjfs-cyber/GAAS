import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  deriveReach,
  scoreActionFeedback,
  PLATFORM_CHANNELS,
} from '../helpers.js';
import {
  executeAction,
  ignoreAction,
  listActions,
  submitActionFeedback,
  assignMarketingActionTask,
} from '../service.js';

function passthroughTenantContext() {
  return {
    run: async (_tid, fn) => fn(),
  };
}

function baseCtx(overrides = {}) {
  return {
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    tenantContext: passthroughTenantContext(),
    resolveTenantIdDefault: () => 'default',
    runTouchRuleEngine: async () => ({ ran: true }),
    executeGrowthActionRecord: async () => ({ action: { action_key: 'k' }, execution: {} }),
    appendExecutionLog: async () => {},
    resolveAgentCanonicalStore: (s) => s,
    ...overrides,
  };
}

test('helpers: cleanText / PLATFORM_CHANNELS', () => {
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.ok(PLATFORM_CHANNELS.includes('wecom'));
});

test('deriveReach: ignored / reached / failed / skipped / internal_only', () => {
  assert.equal(deriveReach({ decision: 'ignored', delivery_total: 5 }), 'ignored');
  assert.equal(deriveReach({ decision: 'executed', delivery_total: 0 }), 'internal_only');
  assert.equal(
    deriveReach({ decision: 'executed', delivery_total: 2, delivery_delivered: 1 }),
    'reached'
  );
  assert.equal(
    deriveReach({
      decision: 'executed',
      delivery_total: 2,
      delivery_delivered: 0,
      delivery_failed: 2,
    }),
    'failed'
  );
  assert.equal(
    deriveReach({
      decision: 'executed',
      delivery_total: 2,
      delivery_delivered: 0,
      delivery_failed: 0,
      delivery_skipped: 2,
    }),
    'skipped'
  );
});

test('scoreActionFeedback: null without actuals; 有效 when meeting targets', () => {
  assert.equal(scoreActionFeedback({}, { reach: 100 }), null);

  const score = scoreActionFeedback(
    { actual_reach: 100, actual_redemptions: 20, actual_revenue_fen: 100000 },
    { reach: 100, redemption_rate: 20, revenue_fen: 100000 }
  );
  assert.equal(score.effectiveness, '有效');
  assert.equal(score.effectiveness_score, 80);
  assert.equal(score.actual_redemption_rate, 20);
});

test('scoreActionFeedback: 无效 when far below targets', () => {
  const score = scoreActionFeedback(
    { actual_reach: 10, actual_redemptions: 0, actual_revenue_fen: 0 },
    { reach: 100, redemption_rate: 20, revenue_fen: 100000 }
  );
  assert.equal(score.effectiveness, '无效');
  assert.ok(score.effectiveness_score < 40);
});

test('executeAction / ignoreAction: action_not_found', async () => {
  const ctx = baseCtx();
  const exec = await executeAction(ctx, 'default', 'missing', { username: 'u', role: 'admin' }, {});
  assert.equal(exec.status, 404);
  assert.equal(exec.body.error, 'action_not_found');

  const ign = await ignoreAction(ctx, 'default', 'missing', { username: 'u', role: 'admin' }, {});
  assert.equal(ign.status, 404);
});

test('listActions: clamps limit and returns empty slice', async () => {
  const ctx = baseCtx({
    pool: {
      async query() {
        return { rows: [] };
      },
    },
  });
  const result = await listActions(ctx, 'default', { limit: 9999, offset: 0 });
  assert.equal(result.status, 200);
  assert.equal(result.body.limit, 500);
  assert.deepEqual(result.body.actions, []);
});

test('submitActionFeedback: action_not_found', async () => {
  const result = await submitActionFeedback(
    baseCtx(),
    'default',
    'missing',
    { username: 'u', role: 'admin' },
    { note: 'x' }
  );
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'action_not_found');
});

// 2026-07-30：用户反馈"营销活动建议"点执行等于什么都没发生——没有责任人、没有任务、没有
// 追踪。锁定新流程：assign-and-execute必须先校验责任人存在且是store_manager/front_manager，
// 生成master_tasks任务(assignee_username=责任人)，然后才照常调用真实的executeGrowthActionRecord。

function actionRow(overrides = {}) {
  return { action_key: 'AK1', title: '新客召回', detail: '详情文本', store_id: '洪潮大宁久光店', action_type: 'promo_task', ...overrides };
}

test('assignMarketingActionTask：缺少assigneeUsername直接400，不查库', async () => {
  const calls = [];
  const ctx = baseCtx({ pool: { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } } });
  const result = await assignMarketingActionTask(ctx, 'default', 'AK1', '', { username: 'admin_a' }, {});
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'missing_assignee');
  assert.equal(calls.length, 0);
});

test('assignMarketingActionTask：action不存在返回404', async () => {
  const ctx = baseCtx({ pool: { async query() { return { rows: [] }; } } });
  const result = await assignMarketingActionTask(ctx, 'default', 'missing', 'front_a', { username: 'admin_a' }, {});
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'action_not_found');
});

test('assignMarketingActionTask：责任人不存在返回400', async () => {
  const calls = [];
  const ctx = baseCtx({
    pool: {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/FROM growth_actions/.test(sql)) return { rows: [actionRow()] };
        if (/FROM employees/.test(sql)) return { rows: [] };
        return { rows: [] };
      },
    },
  });
  const result = await assignMarketingActionTask(ctx, 'default', 'AK1', 'nobody', { username: 'admin_a' }, {});
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'assignee_not_found');
});

test('assignMarketingActionTask：责任人角色不是store_manager/front_manager时拒绝', async () => {
  const ctx = baseCtx({
    pool: {
      async query(sql) {
        if (/FROM growth_actions/.test(sql)) return { rows: [actionRow()] };
        if (/FROM employees/.test(sql)) return { rows: [{ username: 'kitchen_a', name: '张三', role: 'store_production_manager', store: '洪潮大宁久光店' }] };
        return { rows: [] };
      },
    },
  });
  const result = await assignMarketingActionTask(ctx, 'default', 'AK1', 'kitchen_a', { username: 'admin_a' }, {});
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'assignee_role_invalid');
});

test('assignMarketingActionTask：责任人合法时插入master_tasks(assignee_username=责任人)并照常真实执行', async () => {
  const calls = [];
  let executeGrowthActionRecordCalled = false;
  const ctx = baseCtx({
    pool: {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/FROM growth_actions/.test(sql)) return { rows: [actionRow()] };
        if (/FROM employees/.test(sql)) return { rows: [{ username: 'front_a', name: '李四', role: 'front_manager', store: '洪潮大宁久光店' }] };
        if (/INSERT INTO master_tasks/.test(sql)) return { rows: [] };
        return { rows: [] };
      },
    },
    executeGrowthActionRecord: async () => { executeGrowthActionRecordCalled = true; return { action: { status: 'executed' }, execution: { real_executions: [] } }; },
  });
  const result = await assignMarketingActionTask(ctx, 'default', 'AK1', 'front_a', { username: 'admin_a' }, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.taskId.startsWith('MKT-'));
  const insertCall = calls.find((c) => /INSERT INTO master_tasks/.test(c.sql));
  assert.match(insertCall.sql, /assignee_username/);
  assert.equal(insertCall.params[4], 'front_a');
  assert.match(insertCall.sql, /'pending_dispatch'/);
  assert.match(insertCall.sql, /'growth_marketing_action'/);
  assert.ok(executeGrowthActionRecordCalled, '真实的发券/发短信等自动化动作应该照常执行，不因为多了任务分配而跳过');
});

// 2026-07-30：用户反馈"本店未配置店长/前厅主管"——查证生产库growth_actions.store_id
// 没有统一格式(POS原始长名/增长侧数字ID/官方简称混杂)，写进master_tasks.store前必须
// 归一化，否则跟employees.store对不上，任务会变成"孤儿"（分组/展示都找不到对应门店）。
test('assignMarketingActionTask：写入master_tasks.store前用resolveAgentCanonicalStore()归一化store_id', async () => {
  const calls = [];
  const ctx = baseCtx({
    pool: {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/FROM growth_actions/.test(sql)) return { rows: [actionRow({ store_id: '洪潮传统潮汕菜【大宁久光中心店】' })] };
        if (/FROM employees/.test(sql)) return { rows: [{ username: 'front_a', name: '李四', role: 'front_manager', store: '洪潮大宁久光店' }] };
        return { rows: [] };
      },
    },
    resolveAgentCanonicalStore: (s) => (s === '洪潮传统潮汕菜【大宁久光中心店】' ? '洪潮大宁久光店' : s),
  });
  const result = await assignMarketingActionTask(ctx, 'default', 'AK1', 'front_a', { username: 'admin_a' }, {});
  assert.equal(result.status, 200);
  const insertCall = calls.find((c) => /INSERT INTO master_tasks/.test(c.sql));
  assert.equal(insertCall.params[1], '洪潮大宁久光店', 'store字段应该是归一化后的官方简称，不是原始POS长名');
});
