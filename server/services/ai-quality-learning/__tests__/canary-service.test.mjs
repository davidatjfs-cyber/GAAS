import assert from 'node:assert/strict';
import test from 'node:test';

import { monitorActiveCanaries } from '../canary-service.js';

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

test('monitorActiveCanaries skips low-traffic candidates and records observations for candidates with enough samples', async () => {
  const perTenantSamples = {
    'cand-below': { samples: 3, errors: 0, safety_violations: 0, quality_score: 0.9, feedback_count: 0, negative_feedback: 0 },
    'cand-above': { samples: 15, errors: 1, safety_violations: 0, quality_score: 0.85, feedback_count: 4, negative_feedback: 1 },
  };
  const pool = makePool([
    ["status IN ('canary','pending_approval')", () => ({
      rows: [
        { id: 'cand-below', created_at: new Date('2026-07-01') },
        { id: 'cand-above', created_at: new Date('2026-07-01') },
      ],
    })],
    ['INSERT INTO tenants', () => ({ rows: [] })],
    ["SELECT tenant_id FROM tenants WHERE status = 'active'", () => ({
      rows: [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-b' }],
    })],
    ['FROM ai_interaction_traces t', (params) => ({ rows: [perTenantSamples[params[2]]] })],
    ['SELECT * FROM ai_quality_release_candidates WHERE id=$1', () => ({
      rows: [{ id: 'cand-above', status: 'canary', baseline_metrics: { quality_score: 0.8, safety_violation_rate: 0, negative_feedback_rate: 0.1, error_rate: 0.01 } }],
    })],
    ['UPDATE ai_quality_release_candidates', () => ({ rows: [{ id: 'cand-above', status: 'approved' }] })],
    ['INSERT INTO ai_quality_release_events', () => ({ rows: [] })],
  ]);

  const observations = await monitorActiveCanaries(pool);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].candidateId, 'cand-above');
  assert.equal(observations[0].metrics.sample_size, 30); // two tenants x 15 samples
  assert.equal(observations[0].status, 'approved');
  const observationEvent = pool.calls.find((c) => c.text.includes('INSERT INTO ai_quality_release_events'));
  assert.ok(observationEvent);
});

test('monitorActiveCanaries returns no observations when there are no active candidates', async () => {
  const pool = makePool([
    ["status IN ('canary','pending_approval')", () => ({ rows: [] })],
  ]);
  const observations = await monitorActiveCanaries(pool);
  assert.deepEqual(observations, []);
});
