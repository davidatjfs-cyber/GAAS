import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiQualitySchedulerHandlers } from '../ai-quality-scheduler-handlers.js';
import { runModuleLoadSchemaEnsure } from '../module-load-schema-ensure.js';

test('createAiQualitySchedulerHandlers parses JSON and strips fences', async () => {
  const { generateCandidate, evaluateCandidate } = createAiQualitySchedulerHandlers({
    pool: {},
    callLLM: async () => ({}),
    runPlatformQualityModelTask: async (_pool, { execute, operation }) => {
      await execute();
      if (operation === 'generate_prompt_patch') {
        return { ok: true, content: '```json\n{"problem_pattern":"x","prompt_patch":"y"}\n```' };
      }
      return {
        ok: true,
        content: '{"quality_score":0.9,"groundedness":1,"safety_violation_rate":0,"negative_feedback_rate":0,"p95_latency_ms":1,"rationale":"ok"}',
      };
    },
  });
  const gen = await generateCandidate({ route: 'r', samples: [], evidence: {} });
  assert.equal(gen.problem_pattern, 'x');
  const ev = await evaluateCandidate({ route: 'r', samples: [], proposal: {}, evidence: {} });
  assert.equal(ev.quality_score, 0.9);

  const bad = createAiQualitySchedulerHandlers({
    pool: {},
    callLLM: async () => ({}),
    runPlatformQualityModelTask: async () => ({ ok: true, content: 'not-json' }),
  });
  assert.equal(await bad.generateCandidate({ route: 'r', samples: [], evidence: {} }), null);
  assert.equal(await bad.evaluateCandidate({ route: 'r', samples: [], proposal: {}, evidence: {} }), null);

  const fail = createAiQualitySchedulerHandlers({
    pool: {},
    callLLM: async () => ({}),
    runPlatformQualityModelTask: async () => ({ ok: false }),
  });
  assert.equal(await fail.generateCandidate({ route: 'r', samples: [], evidence: {} }), null);
  assert.equal(await fail.evaluateCandidate({ route: 'r', samples: [], proposal: {}, evidence: {} }), null);
});

test('runModuleLoadSchemaEnsure skips when schema changes disallowed', async () => {
  const warns = [];
  const r = await runModuleLoadSchemaEnsure({
    allowSchemaChanges: false,
    appEnv: 'production',
    log: { warn: (p) => warns.push(p) },
  });
  assert.deepEqual(r, { skipped: true });
  assert.equal(warns[0].msg, 'skip_auto_schema_ensure');
});

test('runModuleLoadSchemaEnsure runs ensure cascade and starts ops scheduler', async () => {
  const calls = [];
  const r = await runModuleLoadSchemaEnsure({
    allowSchemaChanges: true,
    appEnv: 'development',
    log: { warn: () => {} },
    runWithBootstrapTenantContext: async (fn) => fn(),
    ensureBaselineSchemaHealth: async () => { calls.push('baseline'); },
    pool: {},
    ensureExamResultsTable: async () => { calls.push('exam'); },
    ensureHrmsStateTable: async () => { calls.push('hrms'); },
    ensureApprovalTables: async () => { calls.push('approval'); },
    ensureUserReadsTable: async () => { calls.push('reads'); },
    ensureUserSessionsTable: async () => { calls.push('sessions'); },
    ensureLoginLogTable: async () => { calls.push('login'); },
    ensureAgentConfigTables: async () => { calls.push('agentcfg'); },
    ensureCheckinTable: async () => { calls.push('checkin'); },
    ensureOpsTasksTable: async () => { calls.push('ops'); },
    ensureFeishuSyncTable: async () => { calls.push('fsync'); },
    ensureFeishuGenericRecordsTable: async () => { calls.push('fgen'); },
    ensureFeishuGenericRecordsNotifyTrigger: async () => { calls.push('ftrig'); },
    ensureTableVisitRecordsTable: async () => { calls.push('tv'); },
    ensureDedupIndexes: async () => { calls.push('dedup'); },
    startOpsTaskScheduler: () => { calls.push('sched'); },
  });
  assert.deepEqual(r, { skipped: false });
  assert.deepEqual(calls, [
    'baseline', 'exam', 'hrms', 'approval', 'reads', 'sessions', 'login', 'agentcfg',
    'checkin', 'ops', 'fsync', 'fgen', 'ftrig', 'tv', 'dedup', 'sched',
  ]);
});

test('runModuleLoadSchemaEnsure logs baseline health failures but continues', async () => {
  const warns = [];
  const calls = [];
  await runModuleLoadSchemaEnsure({
    allowSchemaChanges: true,
    appEnv: 'development',
    log: { warn: (p) => warns.push(p) },
    runWithBootstrapTenantContext: async (fn) => fn(),
    ensureBaselineSchemaHealth: async () => { throw new Error('boom'); },
    pool: {},
    ensureExamResultsTable: async () => { calls.push('exam'); },
    ensureHrmsStateTable: async () => {},
    ensureApprovalTables: async () => {},
    ensureUserReadsTable: async () => {},
    ensureUserSessionsTable: async () => {},
    ensureLoginLogTable: async () => {},
    ensureAgentConfigTables: async () => {},
    ensureCheckinTable: async () => {},
    ensureOpsTasksTable: async () => {},
    ensureFeishuSyncTable: async () => {},
    ensureFeishuGenericRecordsTable: async () => {},
    ensureFeishuGenericRecordsNotifyTrigger: async () => {},
    ensureTableVisitRecordsTable: async () => {},
    ensureDedupIndexes: async () => {},
    startOpsTaskScheduler: () => { calls.push('sched'); },
  });
  assert.equal(warns[0]?.msg, 'schema_baseline_health');
  assert.ok(calls.includes('exam') && calls.includes('sched'));
});
