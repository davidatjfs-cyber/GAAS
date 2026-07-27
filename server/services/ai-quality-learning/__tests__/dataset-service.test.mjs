import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEvaluationDataset, generateImprovementProposals } from '../dataset-service.js';

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

test('buildEvaluationDataset returns no_eligible_candidates when nothing qualifies', async () => {
  const pool = makePool([
    ['FROM ai_learning_candidates c', () => ({ rows: [] })],
  ]);
  const result = await buildEvaluationDataset(pool, {});
  assert.deepEqual(result, { created: false, reason: 'no_eligible_candidates' });
});

test('buildEvaluationDataset caps candidates per tenant and persists dataset items', async () => {
  const rows = [
    { id: 'c1', tenant_id: 'tenant-a', max_daily_contributions: 1, source_tenant_pseudonym: 'p-a', route: 'r', sanitized_input: 'i1', sanitized_output: 'o1', label: 'helpful', label_score: 1 },
    { id: 'c2', tenant_id: 'tenant-a', max_daily_contributions: 1, source_tenant_pseudonym: 'p-a', route: 'r', sanitized_input: 'i2', sanitized_output: 'o2', label: 'helpful', label_score: 1 },
    { id: 'c3', tenant_id: 'tenant-b', max_daily_contributions: 5, source_tenant_pseudonym: 'p-b', route: 'r', sanitized_input: 'i3', sanitized_output: 'o3', label: 'unhelpful', label_score: -1 },
  ];
  const pool = makePool([
    ['FROM ai_learning_candidates c', () => ({ rows })],
    ['INSERT INTO ai_evaluation_datasets', () => ({ rows: [{ id: 'dataset-1', version: 'v-test' }] })],
  ]);
  const result = await buildEvaluationDataset(pool, { maxPerTenant: 10, version: 'v-test' });
  assert.equal(result.created, true);
  assert.equal(result.datasetId, 'dataset-1');
  assert.equal(result.itemCount, 2); // tenant-a capped to 1 via max_daily_contributions, tenant-b keeps 1
  assert.equal(result.tenantCount, 2);
  const itemInserts = pool.calls.filter((c) => c.text.includes('INSERT INTO ai_evaluation_dataset_items'));
  assert.equal(itemInserts.length, 2);
});

test('generateImprovementProposals returns empty without a dataset or generator', async () => {
  assert.deepEqual(await generateImprovementProposals({ query: async () => ({ rows: [] }) }, {}), []);
  assert.deepEqual(
    await generateImprovementProposals({ query: async () => ({ rows: [] }) }, { datasetId: 'd1' }),
    []
  );
});

test('generateImprovementProposals skips groups the generator declines and creates candidates for accepted ones', async () => {
  const groups = [
    { route: 'diagnosis', sample_count: 10, tenant_count: 2 },
    { route: 'marketing', sample_count: 12, tenant_count: 3 },
  ];
  const samplesByRoute = {
    diagnosis: [{ sanitized_input: 'i', sanitized_output: 'o', expected_label: 'unhelpful' }],
    marketing: [
      { sanitized_input: 'i1', sanitized_output: 'o1', expected_label: 'unhelpful' },
      { sanitized_input: 'i2', sanitized_output: 'o2', expected_label: 'helpful' },
    ],
  };
  const pool = makePool([
    ['GROUP BY COALESCE(route', () => ({ rows: groups })],
    ['ORDER BY candidate_id LIMIT 20', (params) => ({ rows: samplesByRoute[params[1]] || [] })],
    ['INSERT INTO ai_quality_release_candidates', (params) => ({ rows: [{ id: `rc-${params[0]}`, artifact_key: params[0], artifact_version: params[1], status: 'draft' }] })],
    ['FROM ai_evaluation_datasets WHERE id=$1', () => ({ rows: [{ id: 'dataset-1', item_count: 12, tenant_count: 3 }] })],
    ['INSERT INTO ai_quality_release_events', () => ({ rows: [] })],
  ]);
  const generateCandidate = async ({ route }) => (route === 'diagnosis' ? null : { prompt_patch: 'improve marketing tone', api_key: 'should-be-redacted' });
  const evaluateCandidate = async () => ({ quality_score: 0.9, groundedness: 0.9, safety_violation_rate: 0, negative_feedback_rate: 0.02, p95_latency_ms: 500 });

  const proposals = await generateImprovementProposals(pool, {
    datasetId: 'dataset-1', datasetVersion: 'v1', generateCandidate, evaluateCandidate,
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].artifact_key, 'marketing');
  assert.ok(proposals[0].evaluation);
  const releaseInsert = pool.calls.find((c) => c.text.includes('INSERT INTO ai_quality_release_candidates') && c.params[0] === 'marketing');
  assert.equal(releaseInsert.params[2].includes('should-be-redacted'), false);
});
