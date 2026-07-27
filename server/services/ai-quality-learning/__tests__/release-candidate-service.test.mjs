import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveReleaseCandidate,
  decideAutomaticPromotion,
  evaluateReleaseCandidate,
  evaluateReleaseGate,
  getRuntimePromptPatch,
  recordCanaryObservation,
  shouldRollbackCanary,
} from '../release-candidate-service.js';

const baseline = {
  quality_score: 0.8,
  groundedness: 0.9,
  safety_violation_rate: 0,
  negative_feedback_rate: 0.1,
  p95_latency_ms: 1000,
  error_rate: 0,
};

const passingCandidate = {
  sample_size: 120,
  tenant_count: 3,
  quality_score: 0.84,
  groundedness: 0.91,
  safety_violation_rate: 0,
  negative_feedback_rate: 0.08,
  p95_latency_ms: 1100,
};

test('release gate requires evidence, quality lift, and non-regression', () => {
  assert.equal(evaluateReleaseGate(baseline, passingCandidate).passed, true);
  assert.equal(evaluateReleaseGate(baseline, { ...passingCandidate, tenant_count: 2 }).passed, false);
  assert.equal(evaluateReleaseGate(baseline, { ...passingCandidate, quality_score: 0.81 }).passed, false);
});

test('canary decision waits for evidence, promotes, and rolls back regressions', () => {
  assert.equal(shouldRollbackCanary(baseline, {
    ...passingCandidate,
    error_rate: 0,
  }).rollback, false);
  assert.equal(decideAutomaticPromotion(baseline, {
    ...passingCandidate,
    sample_size: 99,
    error_rate: 0,
  }).status, 'canary');
  assert.equal(decideAutomaticPromotion(baseline, {
    ...passingCandidate,
    error_rate: 0,
  }).status, 'approved');
  assert.equal(decideAutomaticPromotion(baseline, {
    ...passingCandidate,
    safety_violation_rate: 0.01,
    error_rate: 0.02,
  }).status, 'rolled_back');
});

test('evaluateReleaseCandidate derives dataset evidence and persists a canary gate result', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes('FROM ai_evaluation_datasets')) {
        return { rows: [{ id: 'dataset-1', item_count: 120, tenant_count: 3 }] };
      }
      if (text.includes('INSERT INTO ai_quality_release_candidates')) {
        return { rows: [{ id: 'candidate-1', status: 'canary' }] };
      }
      return { rows: [] };
    },
  };

  const result = await evaluateReleaseCandidate(pool, {
    artifactType: 'prompt_patch',
    artifactKey: 'diagnosis',
    artifactVersion: 'v1',
    artifactPayload: { prompt_patch: 'be specific api_key=do-not-store', api_key: 'do-not-store' },
    datasetId: 'dataset-1',
    baselineMetrics: baseline,
    candidateMetrics: {
      quality_score: 0.84,
      groundedness: 0.91,
      safety_violation_rate: 0,
      negative_feedback_rate: 0.08,
      p95_latency_ms: 1100,
    },
    createdBy: 'admin',
  });

  assert.equal(result.candidate.status, 'canary');
  assert.equal(result.gate.passed, true);
  const candidateInsert = calls.find((call) => call.text.includes('INSERT INTO ai_quality_release_candidates'));
  assert.equal(candidateInsert.params[3].includes('do-not-store'), false);
  assert.equal(candidateInsert.params[3].includes('[SECRET_REDACTED]'), true);
});

test('runtime prompt applies deterministic canary bucketing and observations record transitions', async () => {
  const runtimePool = {
    query: async () => ({
      rows: [{
        id: 'candidate-1',
        artifact_version: 'v1',
        artifact_payload: { prompt_patch: ' Add citations ', canary_percent: 50 },
        status: 'canary',
      }],
    }),
  };
  const first = await getRuntimePromptPatch(runtimePool, {
    artifactKey: 'diagnosis',
    tenantId: 'tenant-a',
    actorId: 'user-a',
  });
  const second = await getRuntimePromptPatch(runtimePool, {
    artifactKey: 'diagnosis',
    tenantId: 'tenant-a',
    actorId: 'user-a',
  });
  assert.deepEqual(second, first);
  if (first) assert.equal(first.patch, 'Add citations');

  const calls = [];
  const observationPool = {
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes('SELECT * FROM ai_quality_release_candidates')) {
        return { rows: [{ id: 'candidate-1', status: 'canary', baseline_metrics: baseline }] };
      }
      if (text.includes('UPDATE ai_quality_release_candidates')) {
        return { rows: [{ id: 'candidate-1', status: 'approved' }] };
      }
      return { rows: [] };
    },
  };
  const observation = await recordCanaryObservation(observationPool, {
    candidateId: 'candidate-1',
    canaryMetrics: { ...passingCandidate, error_rate: 0 },
  });
  assert.equal(observation.candidate.status, 'approved');
  assert.ok(calls.some((call) => call.text.includes('INSERT INTO ai_quality_release_events')));
});

test('approval rejects missing or ungated candidates', async () => {
  await assert.rejects(() => approveReleaseCandidate({ query: async () => ({ rows: [] }) }, {
    candidateId: 'candidate-1',
    approvedBy: 'admin',
  }), /candidate_not_approvable/);
});
