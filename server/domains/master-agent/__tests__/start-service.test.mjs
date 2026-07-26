/**
 * domains/master-agent start orchestration tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTaskId,
  resetTaskIdSequenceForTests,
  seedTaskIdSequence,
} from '../task-lifecycle.js';
import {
  buildAuditTick,
  buildDispatchTick,
  buildMasterIntervalSchedule,
} from '../start-ticks.js';
import { createStartMasterAgent } from '../start-service.js';

test('seedTaskIdSequence advances generateTaskId', () => {
  resetTaskIdSequenceForTests();
  seedTaskIdSequence(41);
  const fixed = new Date('2026-07-27T08:00:00.000Z');
  assert.equal(generateTaskId(fixed), 'MT-20260727-0042');
});

test('buildMasterIntervalSchedule length and order', () => {
  const ticks = Object.fromEntries(
    [
      'auditTick', 'dispatchTick', 'opsTick', 'postResTick', 'evalTick', 'finalTick',
      'trainTick', 'issuesTick', 'trainDispatchTick', 'optimizationTick', 'taskResponseTick',
      'kgHealthTick', 'inspectionLoopTick', 'biPushTick', 'laborTick', 'trainingLoopTick',
    ].map((k) => [k, () => k])
  );
  const schedule = buildMasterIntervalSchedule(ticks);
  assert.equal(schedule.length, 16);
  assert.equal(schedule[0].fn(), 'auditTick');
  assert.equal(schedule[0].intervalMs, 15_000);
  assert.equal(schedule[15].fn(), 'trainingLoopTick');
});

test('buildAuditTick auto-approves manual pending_audit tasks', async () => {
  const transitioned = [];
  const logs = [];
  const tenantTick = (_label, run) => async () => run('default');
  const tick = buildAuditTick(tenantTick, {
    pool: () => ({
      query: async () => ({
        rows: [{ task_id: 'MT-1', title: 'manual' }],
      }),
    }),
    dataAuditorListener: async () => 2,
    transitionTask: async (taskId, status, agent, payload, tenantId) => {
      transitioned.push({ taskId, status, agent, payload, tenantId });
      return true;
    },
    log: { info: (...a) => logs.push(a.join(' ')) },
  });
  const created = await tick();
  assert.equal(created, 2);
  assert.equal(transitioned.length, 1);
  assert.equal(transitioned[0].status, 'pending_dispatch');
  assert.ok(logs.some((l) => l.includes('Auto-approved')));
});

test('buildDispatchTick runs escalation UPDATE then dispatcher', async () => {
  const sqls = [];
  const tenantTick = (_label, run) => async () => run('t1');
  const tick = buildDispatchTick(tenantTick, {
    pool: () => ({
      query: async (sql, params) => {
        sqls.push({ sql: String(sql), params });
        return { rows: [] };
      },
    }),
    masterDispatcher: async (tenantId) => {
      assert.equal(tenantId, 't1');
      return 3;
    },
  });
  assert.equal(await tick(), 3);
  assert.ok(sqls[0].sql.includes('UPDATE master_tasks'));
  assert.equal(sqls[0].params[0], 't1');
});

test('createStartMasterAgent is idempotent and seeds sequence', async () => {
  resetTaskIdSequenceForTests();
  const intervals = [];
  const timeouts = [];
  const origInterval = globalThis.setInterval;
  const origTimeout = globalThis.setTimeout;
  globalThis.setInterval = (fn, ms) => { intervals.push(ms); return 1; };
  globalThis.setTimeout = (fn, ms) => { timeouts.push(ms); return 1; };

  try {
    const start = createStartMasterAgent({
      pool: () => ({
        query: async (sql) => {
          if (String(sql).includes('MAX(id)')) return { rows: [{ maxid: 7 }] };
          return { rows: [] };
        },
      }),
      log: { info() {}, error() {} },
      getActiveTenantIds: async () => [],
      tenantContext: { run: async (_id, fn) => fn() },
      transitionTask: async () => true,
      sendLarkCard: async () => {},
      sendLarkMessage: async () => {},
      lookupFeishuUserByUsername: async () => null,
      writeTaskToBitable: async () => {},
      getTaskResponseFormUrl: () => '',
      buildTaskDispatchCard: () => ({}),
      callLLM: async () => '',
      callVisionLLM: async () => '',
      queryKnowledgeBase: async () => [],
      prefixWithAgentName: (s) => s,
      resolveAssignee: async () => null,
      getSharedState: async () => ({}),
      runDataAuditor: async () => ({ newIssueIds: [] }),
      syncDataAuditorIssuesToMasterTasks: async () => 0,
      AgentCommunicationSystem: class {},
      pollTaskResponseBitable: async () => {},
      refreshEntityHealthSnapshots: async () => 0,
      inspectionClosedLoopTick: async () => 0,
      biProactivePushTick: async () => 0,
      laborEfficiencyTick: async () => 0,
      trainingClosedLoopTick: async () => 0,
    });

    start();
    start(); // idempotent
    await new Promise((r) => origTimeout(r, 20));
    assert.equal(intervals.length, 16);
    assert.ok(timeouts.length >= 16);
    const fixed = new Date('2026-07-27T08:00:00.000Z');
    assert.equal(generateTaskId(fixed), 'MT-20260727-0008');
  } finally {
    globalThis.setInterval = origInterval;
    globalThis.setTimeout = origTimeout;
    resetTaskIdSequenceForTests();
  }
});
