import assert from 'node:assert/strict';
import test from 'node:test';

import { runPlatformQualityModelTask } from '../model-task-service.js';

function makePool(handlers) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      for (const [match, respond] of handlers) {
        if (text.includes(match)) return respond(params);
      }
      return { rows: [] };
    },
  };
}

test('runPlatformQualityModelTask requires an execute function and an operation name', async () => {
  await assert.rejects(() => runPlatformQualityModelTask({ query: async () => ({ rows: [] }) }, {}), /quality_model_execute_required/);
  await assert.rejects(
    () => runPlatformQualityModelTask({ query: async () => ({ rows: [] }) }, { execute: async () => ({}) }),
    /quality_model_operation_required/
  );
});

test('runPlatformQualityModelTask enforces the daily call limit before executing', async () => {
  const pool = makePool([
    ['SELECT COUNT(*)::int AS count', () => ({ rows: [{ count: 5 }] })],
  ]);
  const priorLimit = process.env.AI_QUALITY_DAILY_CALL_LIMIT;
  process.env.AI_QUALITY_DAILY_CALL_LIMIT = '5';
  try {
    const result = await runPlatformQualityModelTask(pool, {
      operation: 'evaluate_prompt_patch',
      execute: async () => ({ ok: true }),
    });
    assert.deepEqual(result, { ok: false, error: 'ai_quality_daily_call_limit_exceeded' });
    assert.equal(pool.calls.some((c) => c.text.includes('INSERT INTO ai_quality_model_calls')), false);
  } finally {
    if (priorLimit == null) delete process.env.AI_QUALITY_DAILY_CALL_LIMIT; else process.env.AI_QUALITY_DAILY_CALL_LIMIT = priorLimit;
  }
});

test('runPlatformQualityModelTask audits a successful call with metadata only (no raw text)', async () => {
  const pool = makePool([
    ['SELECT COUNT(*)::int AS count', () => ({ rows: [{ count: 0 }] })],
  ]);
  const result = await runPlatformQualityModelTask(pool, {
    operation: 'evaluate_prompt_patch',
    route: 'marketing_plan',
    execute: async () => ({
      ok: true, actualModel: 'quality-model', responseTime: 12,
      raw: { usage: { prompt_tokens: 10, completion_tokens: 3 } },
    }),
  });
  assert.equal(result.ok, true);
  const insert = pool.calls.find((c) => c.text.includes('INSERT INTO ai_quality_model_calls'));
  assert.equal(insert.params[0], 'evaluate_prompt_patch');
  assert.equal(insert.params[1], 'marketing_plan');
  assert.equal(insert.params[3], 'quality-model');
  assert.equal(insert.params[4], true);
  assert.equal(insert.params[6], 10);
  assert.equal(insert.params[7], 3);
  assert.equal(insert.params[8], null);
});

test('runPlatformQualityModelTask captures thrown errors and audits the failure metadata', async () => {
  const pool = makePool([
    ['SELECT COUNT(*)::int AS count', () => ({ rows: [{ count: 0 }] })],
  ]);
  const result = await runPlatformQualityModelTask(pool, {
    operation: 'evaluate_prompt_patch',
    execute: async () => { throw new Error('llm timeout'); },
  });
  assert.deepEqual(result, { ok: false, error: 'llm timeout' });
  const insert = pool.calls.find((c) => c.text.includes('INSERT INTO ai_quality_model_calls'));
  assert.equal(insert.params[4], false);
  assert.equal(insert.params[8], 'llm timeout');
});

test('runPlatformQualityModelTask logs but does not throw when the audit insert itself fails', async () => {
  const pool = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT COUNT(*)::int AS count')) return { rows: [{ count: 0 }] };
      if (text.includes('INSERT INTO ai_quality_model_calls')) throw new Error('audit insert failed');
      return { rows: [] };
    },
  };
  const result = await runPlatformQualityModelTask(pool, {
    operation: 'evaluate_prompt_patch',
    execute: async () => ({ ok: true }),
  });
  assert.deepEqual(result, { ok: true });
});
