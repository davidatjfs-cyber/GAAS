/**
 * domains/master-agent task lifecycle tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTaskId,
  resetTaskIdSequenceForTests,
  emitEvent,
  transitionTask,
  createTask,
} from '../task-lifecycle.js';
import { isValidTransition } from '../status-flow.js';
import { createMasterTaskLifecycle } from '../lifecycle-service.js';

function mockPool(handlers) {
  let callIndex = 0;
  const pool = {
    query: async (sql, params) => {
      const handler = handlers[callIndex];
      callIndex += 1;
      if (typeof handler === 'function') return handler(sql, params);
      if (handler !== undefined) return handler;
      throw new Error(`unexpected query #${callIndex}: ${String(sql).slice(0, 100)}`);
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

test('generateTaskId format MT-YYYYMMDD-####', () => {
  resetTaskIdSequenceForTests();
  const fixed = new Date('2026-07-27T08:00:00.000Z');
  assert.equal(generateTaskId(fixed), 'MT-20260727-0001');
  assert.equal(generateTaskId(fixed), 'MT-20260727-0002');
});

test('invalid transition rejected', async () => {
  const getPool = mockPool([
    {
      rows: [
        {
          task_id: 'MT-1',
          status: 'pending_dispatch',
          source: 'scheduled_audit',
          store: '洪潮大宁',
        },
      ],
    },
  ]);
  const { log, entries } = mockLog();

  const result = await transitionTask(getPool, log, 'MT-1', 'closed', 'master');
  assert.equal(result, null);
  assert.ok(entries.error.some((m) => m.includes('invalid transition')));
  assert.equal(isValidTransition('pending_dispatch', 'closed'), false);
});

test('valid transition updates task and emitEvent', async () => {
  const eventInserts = [];
  const getPool = mockPool([
    {
      rows: [
        {
          task_id: 'MT-2',
          status: 'pending_dispatch',
          source: 'scheduled_audit',
          store: '洪潮大宁',
        },
      ],
    },
    (sql) => {
      assert.match(sql, /UPDATE master_tasks SET/);
      assert.match(sql, /status = \$2/);
      return { rows: [] };
    },
    (sql, params) => {
      assert.match(sql, /INSERT INTO master_events/);
      eventInserts.push({ sql, params });
      return { rows: [] };
    },
  ]);
  const { log } = mockLog();

  const result = await transitionTask(getPool, log, 'MT-2', 'dispatched', 'master', {
    assignee_username: 'sm1',
  });
  assert.equal(result?.status, 'dispatched');
  assert.equal(eventInserts.length, 1);
  assert.equal(eventInserts[0].params[1], 'status_dispatched');
  assert.equal(eventInserts[0].params[4], 'pending_dispatch');
  assert.equal(eventInserts[0].params[5], 'dispatched');
});

test('bi_anomaly close syncs anomaly_triggers when anomaly_key+date present', async () => {
  const anomalyUpdates = [];
  const getPool = mockPool([
    {
      rows: [
        {
          task_id: 'MT-3',
          status: 'pending_review',
          source: 'bi_anomaly',
          category: 'revenue_drop',
          store: '洪潮大宁',
          source_data: {
            anomaly_key: 'revenue_drop',
            bi_trigger_date: '2026-07-20',
          },
        },
      ],
    },
    { rows: [] },
    (sql, params) => {
      assert.match(sql, /UPDATE anomaly_triggers/);
      anomalyUpdates.push(params);
      return { rows: [] };
    },
    { rows: [] },
  ]);
  const { log } = mockLog();

  await transitionTask(getPool, log, 'MT-3', 'resolved', 'ops_supervisor');
  assert.equal(anomalyUpdates.length, 1);
  assert.deepEqual(anomalyUpdates[0], ['revenue_drop', '洪潮大宁', '2026-07-20']);
});

test('createTask inserts row and returns task id', async () => {
  resetTaskIdSequenceForTests();
  const inserts = [];
  const getPool = mockPool([
    (sql, params) => {
      assert.match(sql, /INSERT INTO master_tasks/);
      inserts.push(params);
      return { rows: [] };
    },
    { rows: [] },
  ]);
  const { log } = mockLog();
  const kgCalls = [];
  const extractAnomalyRelations = async (payload) => {
    kgCalls.push(payload);
  };

  const taskId = await createTask(
    getPool,
    log,
    { extractAnomalyRelations },
    {
      source: 'data_auditor',
      sourceRef: '42',
      category: '服务差评异常',
      severity: 'high',
      store: '洪潮大宁',
      brand: '洪潮',
      title: '差评跟进',
      detail: '详情',
      sourceData: { foo: 1 },
    },
    'default'
  );

  assert.match(taskId, /^MT-\d{8}-\d{4}$/);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][0], taskId);
  assert.equal(inserts[0][1], 'data_auditor');
  assert.equal(inserts[0][3], '服务差评异常');
  assert.equal(inserts[0][4], 'high');
  assert.equal(kgCalls.length, 1);
  assert.equal(kgCalls[0].task_id, taskId);
});

test('emitEvent inserts master_events row', async () => {
  const getPool = mockPool([
    (sql, params) => {
      assert.match(sql, /INSERT INTO master_events/);
      assert.equal(params[0], 'MT-9');
      assert.equal(params[1], 'task_created');
      return { rows: [] };
    },
  ]);
  const { log } = mockLog();

  await emitEvent(
    getPool,
    log,
    'MT-9',
    'task_created',
    'data_auditor',
    'master',
    null,
    'pending_dispatch',
    { category: 'x' }
  );
});

test('createMasterTaskLifecycle binds resolveAssignee via pickAssigneeForCategory', async () => {
  const { log, entries } = mockLog();
  const lifecycle = createMasterTaskLifecycle({
    getPool: mockPool([]),
    log,
    getSharedState: async () => ({
      employees: [
        { username: 'sm1', name: '店长', role: 'store_manager', store: '洪潮大宁' },
      ],
    }),
    getCategoryAssigneeRoleMap: async () => ({ 充值异常: 'store_manager' }),
    extractAnomalyRelations: async () => {},
  });

  const assignee = await lifecycle.resolveAssignee('充值异常', '洪潮大宁', null, {});
  assert.equal(assignee?.username, 'sm1');
  assert.ok(entries.info.some((m) => m.includes('[resolveAssignee] ✅')));
});

test('createMasterTaskLifecycle bound transitionTask delegates to task-lifecycle', async () => {
  const getPool = mockPool([
    {
      rows: [
        {
          task_id: 'MT-LC-1',
          status: 'pending_dispatch',
          source: 'scheduled_audit',
          store: '洪潮大宁',
        },
      ],
    },
    { rows: [] },
    { rows: [] },
  ]);
  const { log } = mockLog();
  const lifecycle = createMasterTaskLifecycle({
    getPool,
    log,
    getSharedState: async () => ({}),
    getCategoryAssigneeRoleMap: async () => ({}),
  });

  const updated = await lifecycle.transitionTask('MT-LC-1', 'dispatched', 'master');
  assert.equal(updated?.status, 'dispatched');
});

test('createMasterTaskLifecycle resolveAssignee logs cross-store warning', async () => {
  const { log, entries } = mockLog();
  const lifecycle = createMasterTaskLifecycle({
    getPool: mockPool([]),
    log,
    getSharedState: async () => ({
      employees: [
        { username: 'sm2', name: '店长C', role: 'store_manager', store: '马己仙' },
        { username: 'sm1', name: '店长B', role: 'store_manager', store: '洪潮大宁' },
      ],
    }),
    getCategoryAssigneeRoleMap: async () => ({ 充值异常: 'store_manager' }),
  });

  const assignee = await lifecycle.resolveAssignee('充值异常', '洪潮大宁', 'sm2', {});
  assert.equal(assignee?.username, 'sm1');
  assert.ok(entries.warn.some((m) => m.includes('跨门店分派告警')));
});

test('createMasterTaskLifecycle resolveAssignee logs missing_user and no_match', async () => {
  const { log, entries } = mockLog();
  const lifecycle = createMasterTaskLifecycle({
    getPool: mockPool([]),
    log,
    getSharedState: async () => ({ employees: [] }),
    getCategoryAssigneeRoleMap: async () => ({ 产品差评异常: 'store_production_manager' }),
  });

  const missing = await lifecycle.resolveAssignee('充值异常', '洪潮大宁', 'ghost', {});
  assert.equal(missing, null);
  assert.ok(entries.warn.some((m) => m.includes('不存在')));

  entries.error.length = 0;
  const noMatch = await lifecycle.resolveAssignee('产品差评异常', '洪潮大宁', null, {});
  assert.equal(noMatch, null);
  assert.ok(entries.error.some((m) => m.includes('未找到门店')));
});

test('createMasterTaskLifecycle bound createTask and emitEvent', async () => {
  resetTaskIdSequenceForTests();
  const eventCalls = [];
  const pool = {
    query: async (sql, params) => {
      if (/INSERT INTO master_events/.test(sql)) eventCalls.push(params);
      return { rows: [] };
    },
  };
  const { log } = mockLog();
  const lifecycle = createMasterTaskLifecycle({
    getPool: () => pool,
    log,
    getSharedState: async () => ({}),
    getCategoryAssigneeRoleMap: async () => ({}),
  });

  const taskId = await lifecycle.createTask({
    category: '测试',
    store: '洪潮大宁',
    title: 't',
    detail: 'd',
  });
  assert.match(taskId, /^MT-/);
  assert.equal(eventCalls.length, 1);

  await lifecycle.emitEvent('MT-X', 'manual', 'master', null, 'open', 'closed', {});
  assert.equal(eventCalls.length, 2);
  assert.equal(eventCalls[1][1], 'manual');
});
