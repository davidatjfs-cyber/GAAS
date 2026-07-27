import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPlatformQualityActivity,
  getPlatformQualityOverview,
  getTenantQualityOverview,
} from '../overview-service.js';

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

test('getTenantQualityOverview scopes counters to the resolved tenant', async () => {
  const pool = makePool([
    ['FROM ai_interaction_traces', () => ({
      rows: [{ traces: 12, feedback: 4, eligible_candidates: 2, platform_learning_enabled: true }],
    })],
  ]);
  const overview = await getTenantQualityOverview(pool, 'tenant-a');
  assert.equal(overview.traces, 12);
  const call = pool.calls[0];
  assert.equal(call.params[0], 'tenant-a');

  const empty = await getTenantQualityOverview(makePool([]), 'tenant-b');
  assert.deepEqual(empty, {});
});

test('getPlatformQualityOverview merges platform quality model configuration into the counts', async () => {
  const pool = makePool([
    ['SELECT\n        (SELECT COUNT(*)::int FROM ai_learning_policies', () => ({
      rows: [{ contract_authorized_tenants: 3, eligible_candidates: 20, contributing_tenants: 3, datasets: 2, open_release_candidates: 1, quality_model_calls_today: 5 }],
    })],
  ]);
  const priorKey = process.env.AI_QUALITY_LLM_API_KEY;
  const priorProvider = process.env.AI_QUALITY_LLM_PROVIDER;
  const priorModel = process.env.AI_QUALITY_LLM_MODEL;
  const priorLimit = process.env.AI_QUALITY_DAILY_CALL_LIMIT;
  process.env.AI_QUALITY_LLM_API_KEY = 'test-key';
  process.env.AI_QUALITY_LLM_PROVIDER = 'deepseek';
  process.env.AI_QUALITY_LLM_MODEL = 'deepseek-chat';
  process.env.AI_QUALITY_DAILY_CALL_LIMIT = '250';
  try {
    const overview = await getPlatformQualityOverview(pool);
    assert.equal(overview.contract_authorized_tenants, 3);
    assert.equal(overview.platform_quality_model_configured, true);
    assert.equal(overview.platform_quality_model_provider, 'deepseek');
    assert.equal(overview.platform_quality_model_name, 'deepseek-chat');
    assert.equal(overview.quality_model_daily_limit, 250);
  } finally {
    if (priorKey == null) delete process.env.AI_QUALITY_LLM_API_KEY; else process.env.AI_QUALITY_LLM_API_KEY = priorKey;
    if (priorProvider == null) delete process.env.AI_QUALITY_LLM_PROVIDER; else process.env.AI_QUALITY_LLM_PROVIDER = priorProvider;
    if (priorModel == null) delete process.env.AI_QUALITY_LLM_MODEL; else process.env.AI_QUALITY_LLM_MODEL = priorModel;
    if (priorLimit == null) delete process.env.AI_QUALITY_DAILY_CALL_LIMIT; else process.env.AI_QUALITY_DAILY_CALL_LIMIT = priorLimit;
  }
});

test('getPlatformQualityActivity aggregates policies, cycles, releases, and model calls in parallel', async () => {
  const pool = makePool([
    ['FROM ai_learning_policies\n          WHERE platform_learning_enabled=TRUE', () => ({ rows: [{ tenant_id: 'tenant-a' }] })],
    ['FROM ai_learning_cycle_runs', () => ({ rows: [{ id: 1, status: 'completed' }] })],
    ['FROM ai_quality_release_events e', () => ({ rows: [{ id: 2, artifact_key: 'diagnosis' }] })],
    ['FROM ai_quality_model_calls ORDER BY created_at DESC LIMIT 200', () => ({ rows: [{ id: 3, operation: 'evaluate' }] })],
  ]);
  const activity = await getPlatformQualityActivity(pool);
  assert.equal(activity.policies.length, 1);
  assert.equal(activity.cycles[0].status, 'completed');
  assert.equal(activity.releases[0].artifact_key, 'diagnosis');
  assert.equal(activity.modelCalls[0].operation, 'evaluate');
});
