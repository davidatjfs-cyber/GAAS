import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

import { runAiQualityLearningCycle, startAiQualityLearningScheduler } from '../learning-cycle-service.js';

/**
 * Runs the real backfill/contract-policy/dataset/canary collaborators end-to-end
 * (no module mocking) against an empty-but-consistent dataset, so this exercises
 * the actual orchestration lines in learning-cycle-service.js without needing
 * `--experimental-test-module-mocks`, which package.json's test scripts don't enable.
 */
function makeCyclePool({ activeTenants = ['tenant-a', 'tenant-b'] } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes('INSERT INTO ai_learning_cycle_runs')) return { rows: [{ id: 'run-1', started_at: new Date() }] };
      if (text.includes('UPDATE ai_learning_cycle_runs')) return { rows: [] };
      if (text.includes("SELECT tenant_id FROM tenants WHERE status='active' ORDER BY tenant_id")) {
        return { rows: activeTenants.map((tenant_id) => ({ tenant_id })) };
      }
      if (text.includes('FROM sales_orders o')) return { rows: [] };
      if (text.includes("WHERE authorization_source='sales_crm'")) return { rows: [] };
      if (text.includes("WHERE platform_learning_enabled=TRUE AND authorization_basis='contract'")) return { rows: [] };
      if (text.includes('INSERT INTO tenants')) return { rows: [] };
      if (text.includes("SELECT tenant_id FROM tenants WHERE status = 'active'")) {
        return { rows: activeTenants.map((tenant_id) => ({ tenant_id })) };
      }
      if (text.includes('SELECT retention_days FROM ai_learning_policies')) return { rows: [] };
      if (text.includes('UPDATE ai_interaction_traces')) return { rows: [] };
      if (text.includes('UPDATE ai_feedback_events SET actor_id=NULL')) return { rows: [] };
      if (text.includes("UPDATE ai_learning_candidates SET status='archived'")) return { rows: [] };
      if (text.includes('UPDATE agent_quality_audits') && text.includes('RETAINED_HASH_ONLY')) return { rows: [] };
      if (text.includes('UPDATE diagnosis_feedback') && text.includes('RETAINED_HASH_ONLY')) return { rows: [] };
      if (text.includes('FROM agent_quality_audits') && text.includes('trace_id IS NULL')) return { rows: [] };
      if (text.includes('FROM diagnosis_feedback') && text.includes('trace_id IS NULL')) return { rows: [] };
      if (text.includes('FROM ai_feedback_events f') && text.includes('NOT EXISTS')) return { rows: [] };
      if (text.includes('FROM ai_learning_candidates c')) return { rows: [] };
      if (text.includes("status IN ('canary','pending_approval')")) return { rows: [] };
      return { rows: [] };
    },
  };
}

function withPseudonymKey(fn) {
  return async () => {
    const prior = process.env.AI_LEARNING_PSEUDONYM_KEY;
    process.env.AI_LEARNING_PSEUDONYM_KEY = 'test-key';
    try {
      await fn();
    } finally {
      if (prior == null) delete process.env.AI_LEARNING_PSEUDONYM_KEY;
      else process.env.AI_LEARNING_PSEUDONYM_KEY = prior;
    }
  };
}

test('runAiQualityLearningCycle runs an end-to-end cycle and persists completion counts', withPseudonymKey(async () => {
  const pool = makeCyclePool();
  const result = await runAiQualityLearningCycle(pool, { triggerType: 'manual' });

  assert.equal(result.runId, 'run-1');
  assert.equal(result.dataset.created, false);
  assert.deepEqual(result.proposals, []);
  assert.deepEqual(result.canaries, []);
  assert.ok(result.completedAt);

  const completedUpdate = pool.calls.find((c) => c.text.includes("status='completed'"));
  assert.ok(completedUpdate);
  assert.equal(completedUpdate.params[0], 'run-1');
  assert.equal(completedUpdate.params[1], 2); // policySync.activeTenants
  assert.equal(completedUpdate.params[2], 0); // traced totals (no audit/diagnosis rows)
  assert.equal(completedUpdate.params[9], 0); // promoted_count
  assert.equal(completedUpdate.params[10], 0); // rolled_back_count
}));

test('runAiQualityLearningCycle marks the run failed and rethrows when a required precondition is missing', async () => {
  const prior = process.env.AI_LEARNING_PSEUDONYM_KEY;
  delete process.env.AI_LEARNING_PSEUDONYM_KEY;
  try {
    const pool = makeCyclePool();
    await assert.rejects(() => runAiQualityLearningCycle(pool, {}), /AI_LEARNING_PSEUDONYM_KEY_required/);
    const failedUpdate = pool.calls.find((c) => c.text.includes("status='failed'"));
    assert.ok(failedUpdate);
    assert.equal(failedUpdate.params[0], 'run-1');
    assert.match(failedUpdate.params[1], /AI_LEARNING_PSEUDONYM_KEY_required/);
  } finally {
    if (prior == null) delete process.env.AI_LEARNING_PSEUDONYM_KEY;
    else process.env.AI_LEARNING_PSEUDONYM_KEY = prior;
  }
});

test('startAiQualityLearningScheduler runs cycles on a timer and stop() halts further ticks', withPseudonymKey(async () => {
  const pool = makeCyclePool();
  const timers = mock.timers;
  timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const stop = startAiQualityLearningScheduler(pool, { initialDelayMs: 1000, intervalMs: 60000 });
    await timers.tick(1000);
    await new Promise((resolve) => setImmediate(resolve));
    const firstRunCalls = pool.calls.filter((c) => c.text.includes('INSERT INTO ai_learning_cycle_runs')).length;
    assert.equal(firstRunCalls, 1);

    stop();
    await timers.tick(60000);
    await new Promise((resolve) => setImmediate(resolve));
    const afterStopCalls = pool.calls.filter((c) => c.text.includes('INSERT INTO ai_learning_cycle_runs')).length;
    assert.equal(afterStopCalls, 1); // no additional cycle after stop()
  } finally {
    timers.reset();
  }
}));

test('startAiQualityLearningScheduler swallows cycle failures without crashing the process', async () => {
  const prior = process.env.AI_LEARNING_PSEUDONYM_KEY;
  delete process.env.AI_LEARNING_PSEUDONYM_KEY;
  const timers = mock.timers;
  timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    const pool = makeCyclePool();
    const stop = startAiQualityLearningScheduler(pool, { initialDelayMs: 1000, intervalMs: 60000 });
    await timers.tick(1000);
    await new Promise((resolve) => setImmediate(resolve));
    stop();
  } finally {
    timers.reset();
    if (prior == null) delete process.env.AI_LEARNING_PSEUDONYM_KEY;
    else process.env.AI_LEARNING_PSEUDONYM_KEY = prior;
  }
});
