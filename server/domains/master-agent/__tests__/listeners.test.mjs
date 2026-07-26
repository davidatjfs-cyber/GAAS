/**
 * domains/master-agent listener tests (ops + train)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpsDispatchState, processOpsDispatchNotify } from '../ops-dispatch.js';
import { processOpsReview } from '../ops-review.js';
import { createOpsAgentListener } from '../ops-listener.js';
import { createTrainAgentListener } from '../train-listener.js';
import { createMasterListeners } from '../listeners-service.js';
import {
  chiefEvaluatorListener,
  dataAuditorListener,
  masterDispatcher,
  masterPostResolution,
  trainTaskDispatcher,
} from '../master-listeners.js';

function mockPool(handlers) {
  let callIndex = 0;
  const pool = {
    query: async (sql, params) => {
      const handler = handlers[callIndex];
      callIndex += 1;
      if (typeof handler === 'function') return handler(sql, params, callIndex);
      if (handler !== undefined) return handler;
      throw new Error(`unexpected query #${callIndex}: ${String(sql).slice(0, 120)}`);
    },
  };
  return () => pool;
}

function mockLog() {
  const entries = { error: [], warn: [], info: [] };
  return {
    log: {
      error: (...args) => entries.error.push(args.join(' ')),
      warn: (...args) => entries.warn.push(args.join(' ')),
      info: (...args) => entries.info.push(args.join(' ')),
    },
    entries,
  };
}

function baseOpsDeps(overrides = {}) {
  const { log } = mockLog();
  return {
    pool: mockPool([]),
    log,
    transitionTask: async () => ({ status: 'pending_response' }),
    lookupFeishuUserByUsername: async () => null,
    writeTaskToBitable: async () => null,
    getTaskResponseFormUrl: () => 'https://form.example/task',
    buildTaskDispatchCard: () => ({ header: {} }),
    sendLarkCard: async () => ({ ok: false }),
    sendLarkMessage: async () => ({ ok: true }),
    prefixWithAgentName: (_agent, msg) => msg,
    callLLM: async () => ({ content: '{"valid":true}' }),
    callVisionLLM: async () => ({ content: '{"valid":true}' }),
    queryKnowledgeBase: async () => [],
    ...overrides,
  };
}

test('ops dispatch: no Feishu user retries then force pending_response', async () => {
  const transitions = [];
  const task = {
    task_id: 'MT-OPS-1',
    assignee_username: 'ghost',
    title: '测试任务',
  };
  const getPool = mockPool([
    { rows: [task] },
    { rows: [task] },
    { rows: [task] },
  ]);
  const { log, entries } = mockLog();

  const deps = {
    ...baseOpsDeps({
      pool: getPool,
      transitionTask: async (taskId, status, agent, payload, tenantId) => {
        transitions.push({ taskId, status, agent, payload, tenantId });
        return { status };
      },
    }),
    log,
  };
  const state = createOpsDispatchState();

  assert.equal(await processOpsDispatchNotify(deps, state, 'default'), 0);
  assert.equal(await processOpsDispatchNotify(deps, state, 'default'), 0);
  const actions = await processOpsDispatchNotify(deps, state, 'default');

  assert.equal(actions, 1);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].status, 'pending_response');
  assert.equal(transitions[0].agent, 'ops_supervisor');
  assert.ok(entries.warn.some((m) => m.includes('No Feishu user')));
  assert.ok(entries.warn.some((m) => m.includes('Forcing MT-OPS-1')));
});

test('ops dispatch: successful card send transitions and inserts agent_messages', async () => {
  const transitions = [];
  const agentMessageInserts = [];
  const task = {
    task_id: 'MT-OPS-2',
    assignee_username: 'sm1',
    title: '整改任务',
  };
  const getPool = mockPool([
    { rows: [task] },
    { rows: [] },
    { rows: [{ cnt: '0' }] },
    (sql, params) => {
      assert.match(sql, /INSERT INTO agent_messages/);
      agentMessageInserts.push(params);
      return { rows: [] };
    },
  ]);
  const { log } = mockLog();

  const deps = {
    ...baseOpsDeps({
      pool: getPool,
      lookupFeishuUserByUsername: async () => ({ open_id: 'ou_test' }),
      writeTaskToBitable: async () => ({ record_id: 'rec_1' }),
      sendLarkCard: async () => ({
        ok: true,
        data: { data: { message_id: 'msg_123' } },
      }),
      transitionTask: async (taskId, status, agent, payload) => {
        transitions.push({ taskId, status, agent, payload });
        return { status };
      },
    }),
    log,
  };

  const actions = await processOpsDispatchNotify(deps, createOpsDispatchState(), 'default');

  assert.equal(actions, 1);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].status, 'pending_response');
  assert.equal(transitions[0].payload.feishu_msg_id, 'msg_123');
  assert.equal(agentMessageInserts.length, 1);
  assert.equal(agentMessageInserts[0][0], 'ou_test');
  assert.match(agentMessageInserts[0][1], /MT-OPS-2/);
});

test('ops review: resolves when LLM and vision pass', async () => {
  const transitions = [];
  const messages = [];
  const task = {
    task_id: 'MT-REV-1',
    assignee_username: 'sm1',
    title: '审核任务',
    category: '服务差评异常',
    response_text: '已整改完成',
    response_images: ['https://img/1.jpg'],
  };
  const getPool = mockPool([{ rows: [task] }]);
  const { log } = mockLog();

  const deps = {
    ...baseOpsDeps({
      pool: getPool,
      callVisionLLM: async () => ({ content: '{"valid":true,"reason":"合格"}' }),
      callLLM: async () => ({ content: '{"valid":true,"reason":"有效"}' }),
      transitionTask: async (taskId, status, agent, payload) => {
        transitions.push({ taskId, status, agent, payload });
        return { status, task_id: taskId };
      },
      lookupFeishuUserByUsername: async () => ({ open_id: 'ou_sm1' }),
      sendLarkMessage: async (openId, msg) => {
        messages.push({ openId, msg });
        return { ok: true };
      },
    }),
    log,
  };

  const actions = await processOpsReview(deps, 'default');

  assert.equal(actions, 1);
  assert.equal(transitions[0].status, 'resolved');
  assert.equal(transitions[0].payload.review_result.decision, 'resolved');
  assert.equal(messages.length, 1);
  assert.match(messages[0].msg, /审核结论：✅ 通过/);
});

test('ops review: rejects when text review fails', async () => {
  const transitions = [];
  const task = {
    task_id: 'MT-REV-2',
    assignee_username: 'sm2',
    title: '审核任务',
    response_text: '好的',
    response_images: [],
  };
  const getPool = mockPool([{ rows: [task] }]);
  const { log } = mockLog();

  const deps = {
    ...baseOpsDeps({
      pool: getPool,
      callLLM: async () => ({ content: '{"valid":false,"reason":"回复过于简短"}' }),
      transitionTask: async (_taskId, status, _agent, payload) => {
        transitions.push({ status, payload });
        return { status };
      },
      lookupFeishuUserByUsername: async () => null,
    }),
    log,
  };

  const actions = await processOpsReview(deps, 'default');

  assert.equal(actions, 1);
  assert.equal(transitions[0].status, 'rejected');
  assert.equal(transitions[0].payload.review_result.decision, 'rejected');
});

test('createOpsAgentListener runs dispatch and review cycles', async () => {
  const { log } = mockLog();
  const deps = {
    ...baseOpsDeps({
      pool: mockPool([
        { rows: [] },
        { rows: [] },
      ]),
    }),
    log,
  };

  const listener = createOpsAgentListener(deps);
  const actions = await listener('default');
  assert.equal(actions, 0);
});

test('train listener: creates sop case from detailed bad review', async () => {
  const inserts = [];
  const review = {
    id: 'br-1',
    store: '洪潮大宁',
    brand: '洪潮',
    review_type: 'service',
    event_detail: '上菜慢',
    content: '服务差',
  };
  const getPool = mockPool([
    { rows: [] },
    { rows: [review] },
    (sql, params) => {
      assert.match(sql, /INSERT INTO sop_cases/);
      inserts.push(params);
      return { rows: [{ id: 'sop-uuid-1' }] };
    },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ]);
  const { log, entries } = mockLog();
  const messages = [];

  const listener = createTrainAgentListener({
    pool: getPool,
    log,
    lookupFeishuUserByUsername: async () => ({ open_id: 'ou_mgr' }),
    sendLarkMessage: async (_id, msg) => {
      messages.push(msg);
    },
    prefixWithAgentName: (_a, msg) => msg,
    queryKnowledgeBase: async () => [],
    resolveAssignee: async () => ({ username: 'sm1' }),
    getSharedState: async () => ({}),
  });

  const actions = await listener('default');

  assert.equal(actions, 1);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][2], '洪潮大宁');
  assert.ok(messages.some((m) => m.includes('SOP案例分析请求')));
  assert.ok(entries.info.some((m) => m.includes('Created SOP case')));
});

test('train listener: publishes confirmed sop case', async () => {
  const updates = [];
  const sopCase = {
    id: 'case-db-1',
    case_id: 'SOP-PUB-1',
    store: '洪潮大宁',
    brand: '洪潮',
    analysis: '分析内容',
    improvement_actions: '改进措施',
  };
  const getPool = mockPool([
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [sopCase] },
    (sql, params) => {
      assert.match(sql, /UPDATE sop_cases SET status = 'published'/);
      updates.push(params);
      return { rows: [] };
    },
  ]);
  const { log, entries } = mockLog();

  const listener = createTrainAgentListener({
    pool: getPool,
    log,
    lookupFeishuUserByUsername: async () => null,
    sendLarkMessage: async () => {},
    prefixWithAgentName: (_a, msg) => msg,
    queryKnowledgeBase: async () => [],
    resolveAssignee: async () => null,
    getSharedState: async () => ({ knowledgeBase: {} }),
  });

  const actions = await listener('default');

  assert.equal(actions, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], 'case-db-1');
  assert.ok(entries.info.some((m) => m.includes('published to SOP library')));
});

test('createMasterListeners returns all wired listener fns', () => {
  const { log } = mockLog();
  const listeners = createMasterListeners({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    log,
    transitionTask: async () => null,
    sendLarkCard: async () => ({ ok: false }),
    sendLarkMessage: async () => ({}),
    lookupFeishuUserByUsername: async () => null,
    writeTaskToBitable: async () => null,
    getTaskResponseFormUrl: () => '',
    buildTaskDispatchCard: () => ({}),
    callLLM: async () => ({ content: '{}' }),
    callVisionLLM: async () => ({ content: '{}' }),
    queryKnowledgeBase: async () => [],
    prefixWithAgentName: (_a, m) => m,
    resolveAssignee: async () => null,
    getSharedState: async () => ({}),
    runDataAuditor: async () => ({ newIssueIds: [] }),
    syncDataAuditorIssuesToMasterTasks: async () => 0,
    AgentCommunicationSystem: { assignIssue: async () => {}, approveOptimization: async () => {} },
  });

  for (const name of [
    'opsAgentListener',
    'trainAgentListener',
    'dataAuditorListener',
    'masterDispatcher',
    'masterPostResolution',
    'chiefEvaluatorListener',
  ]) {
    assert.equal(typeof listeners[name], 'function', `${name} should be a function`);
  }
});

test('dataAuditorListener syncs new issues from runDataAuditor', async () => {
  const synced = [];
  const { log } = mockLog();
  const count = await dataAuditorListener(
    {
      runDataAuditor: async () => ({ newIssueIds: ['1', '2'] }),
      syncDataAuditorIssuesToMasterTasks: async (ids, tenantId) => {
        synced.push({ ids, tenantId });
        return ids.length;
      },
      log,
    },
    'tenant-a'
  );
  assert.equal(count, 2);
  assert.deepEqual(synced[0], { ids: ['1', '2'], tenantId: 'tenant-a' });
});

test('masterDispatcher assigns pending_dispatch tasks', async () => {
  const task = {
    task_id: 'MT-D-1',
    category: '服务差评异常',
    store: '洪潮大宁',
    assignee_username: null,
    source_data: {},
  };
  const transitions = [];
  const getPool = mockPool([{ rows: [task] }]);
  const { log } = mockLog();

  const count = await masterDispatcher(
    {
      pool: getPool,
      log,
      resolveAssignee: async () => ({ username: 'sm1', role: 'store_manager' }),
      transitionTask: async (taskId, status, agent, payload, tenantId) => {
        transitions.push({ taskId, status, agent, payload, tenantId });
        return { status };
      },
    },
    'default'
  );

  assert.equal(count, 1);
  assert.equal(transitions[0].status, 'dispatched');
  assert.equal(transitions[0].payload.assignee_username, 'sm1');
});

test('masterPostResolution moves resolved tasks to pending_settlement', async () => {
  const task = { task_id: 'MT-R-1' };
  const transitions = [];
  const getPool = mockPool([{ rows: [task] }]);
  const { log } = mockLog();

  const count = await masterPostResolution(
    {
      pool: getPool,
      log,
      transitionTask: async (taskId, status) => {
        transitions.push({ taskId, status });
        return { status };
      },
    },
    'default'
  );

  assert.equal(count, 1);
  assert.equal(transitions[0].status, 'pending_settlement');
});

test('chiefEvaluatorListener settles pending_settlement tasks', async () => {
  const task = {
    task_id: 'MT-E-1',
    category: '测试',
    severity: 'medium',
    dispatched_at: '2026-07-26T10:00:00.000Z',
    responded_at: '2026-07-26T12:00:00.000Z',
  };
  const transitions = [];
  const getPool = mockPool([{ rows: [task] }]);
  const { log } = mockLog();

  const count = await chiefEvaluatorListener(
    {
      pool: getPool,
      log,
      transitionTask: async (taskId, status, agent, payload) => {
        transitions.push({ taskId, status, agent, payload });
        return { status };
      },
    },
    'default'
  );

  assert.equal(count, 1);
  assert.equal(transitions[0].status, 'settled');
  assert.equal(transitions[0].payload.score_impact, 0);
});

test('trainTaskDispatcher sends pending training tasks', async () => {
  const task = {
    id: 'tt-1',
    task_id: 'TR-1',
    assignee_username: 'emp1',
    title: '入职培训',
    type: 'onboarding',
    target_role: 'cashier',
    due_date: '2026-08-01',
  };
  const updates = [];
  const messages = [];
  const getPool = mockPool([
    { rows: [task] },
    (sql, params) => {
      assert.match(sql, /UPDATE training_tasks SET status = 'in_progress'/);
      updates.push(params);
      return { rows: [] };
    },
  ]);
  const { log } = mockLog();

  const count = await trainTaskDispatcher(
    {
      pool: getPool,
      log,
      lookupFeishuUserByUsername: async () => ({ open_id: 'ou_emp' }),
      sendLarkMessage: async (_id, msg) => {
        messages.push(msg);
      },
      prefixWithAgentName: (_a, msg) => msg,
    },
    'default'
  );

  assert.equal(count, 1);
  assert.equal(updates.length, 1);
  assert.ok(messages[0].includes('培训任务下发'));
});

test('train listener: auto-prepares draft_need training task', async () => {
  const task = {
    id: 'tt-draft',
    task_id: 'TR-DRAFT',
    title: '专项提升：服务标准',
    assignee_username: 'emp2',
    brand: '洪潮',
    progress_data: {},
  };
  const updates = [];
  const getPool = mockPool([
    { rows: [task] },
    (sql, params) => {
      assert.match(sql, /UPDATE training_tasks SET status = 'pending_approval'/);
      updates.push(JSON.parse(params[0]));
      return { rows: [] };
    },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ]);
  const { log } = mockLog();

  const listener = createTrainAgentListener({
    pool: getPool,
    log,
    lookupFeishuUserByUsername: async () => ({ open_id: 'ou_admin' }),
    sendLarkMessage: async () => {},
    prefixWithAgentName: (_a, msg) => msg,
    queryKnowledgeBase: async () => [{ title: 'SOP-服务' }],
    resolveAssignee: async () => null,
    getSharedState: async () => ({}),
  });

  const actions = await listener('default');

  assert.equal(actions, 1);
  assert.ok(updates[0].outline.includes('专项提升：服务标准'));
  assert.ok(updates[0].prepared_at);
});
