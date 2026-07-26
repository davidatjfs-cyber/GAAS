import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrustScore,
  classifyConfidenceLevel,
  getUsagePolicy,
  getConflictRule,
  listConflictRules,
  recordDataQuality,
} from './data-trust-service.js';

test('computeTrustScore gives high score for objective POS source', () => {
  const { score, breakdown } = computeTrustScore({ sourceType: 'pos_order' });
  assert.ok(score >= 80, `score=${score}`);
  assert.equal(breakdown.source, 100);
});

test('computeTrustScore penalizes temporal and spatial conflicts', () => {
  const clean = computeTrustScore({ sourceType: 'employee_manual_entry' }).score;
  const dirty = computeTrustScore({
    sourceType: 'employee_manual_entry',
    temporalConflicts: [{ penalty: 40 }],
    spatialDistanceMeters: 500,
    behaviorAnomalies: [{ penalty: 20 }],
  }).score;
  assert.ok(dirty < clean);
});

test('computeTrustScore adjusts crossSourceChecks', () => {
  const neutral = computeTrustScore({
    sourceType: 'manager_confirmation',
    crossSourceChecks: [],
  }).breakdown.crossSource;
  const consistent = computeTrustScore({
    sourceType: 'manager_confirmation',
    crossSourceChecks: [{ ruleId: 'revenue_vs_payment_flow', result: 'consistent' }],
  }).breakdown.crossSource;
  const conflict = computeTrustScore({
    sourceType: 'manager_confirmation',
    crossSourceChecks: [{ ruleId: 'revenue_vs_payment_flow', result: 'conflict' }],
  }).breakdown.crossSource;
  assert.ok(consistent > neutral);
  assert.ok(conflict < neutral);
});

test('classifyConfidenceLevel maps score bands', () => {
  assert.equal(classifyConfidenceLevel(95), 'high');
  assert.equal(classifyConfidenceLevel(80), 'medium');
  assert.equal(classifyConfidenceLevel(60), 'low');
  assert.equal(classifyConfidenceLevel(40), 'suspect');
  assert.equal(classifyConfidenceLevel(10), 'conflict');
});

test('getUsagePolicy gates benchmark entry by score', () => {
  assert.equal(getUsagePolicy(92).entersBenchmark, true);
  assert.equal(getUsagePolicy(80).weight, 0.6);
  assert.equal(getUsagePolicy(60).action, 'display_only');
  assert.equal(getUsagePolicy(20).action, 'flag_anomaly_audit');
});

test('getConflictRule and listConflictRules expose matrix', () => {
  const rule = getConflictRule('gps_vs_store_location');
  assert.ok(rule);
  assert.equal(rule.impact, 25);
  assert.ok(listConflictRules().length >= 10);
  assert.equal(getConflictRule('unknown_rule'), null);
});

test('recordDataQuality persists computed score via pool', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: 1, trust_score: params[5] }] };
    },
  };
  const row = await recordDataQuality(pool, {
    dataId: 'd1',
    dataType: 'inspection',
    tenantId: 'default',
    storeId: 's1',
    sourceType: 'pos_order',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO growth_ontology_data_quality/i);
  assert.ok(row.usagePolicy);
  assert.ok(Number(row.trust_score) >= 80);
});
