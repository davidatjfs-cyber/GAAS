import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTrustScore,
  classifyConfidenceLevel,
  getUsagePolicy,
  getConflictRule,
  listConflictRules,
} from './data-trust-service.js';

test('computeTrustScore: POS-sourced data with no conflicts scores high', () => {
  const { score, breakdown } = computeTrustScore({ sourceType: 'pos_order' });
  assert.ok(score >= 75, `expected high score, got ${score}`);
  assert.equal(breakdown.source, 100);
});

test('computeTrustScore: employee manual entry with GPS 800m away from store gets penalized', () => {
  const clean = computeTrustScore({ sourceType: 'employee_manual_entry' });
  const withGpsConflict = computeTrustScore({ sourceType: 'employee_manual_entry', spatialDistanceMeters: 800 });
  assert.ok(withGpsConflict.score < clean.score, 'GPS mismatch should lower trust score');
});

test('computeTrustScore: cross-source conflict (training done but complaints up) drags score down hard', () => {
  const consistent = computeTrustScore({
    sourceType: 'employee_upload',
    crossSourceChecks: [{ ruleId: 'training_vs_complaint_rate', result: 'consistent' }],
  });
  const conflicting = computeTrustScore({
    sourceType: 'employee_upload',
    crossSourceChecks: [{ ruleId: 'training_vs_complaint_rate', result: 'conflict' }],
  });
  assert.ok(conflicting.score < consistent.score);
  // 用户举的例子：认证分很高但退菜率异常——这类冲突应该把分数拉到 conflict 或 suspect 档
  assert.ok(['conflict', 'suspect', 'low'].includes(classifyConfidenceLevel(conflicting.score)));
});

test('computeTrustScore: behavior anomaly (identical photo every day) penalizes score', () => {
  const clean = computeTrustScore({ sourceType: 'employee_upload' });
  const suspicious = computeTrustScore({
    sourceType: 'employee_upload',
    behaviorAnomalies: [{ type: 'duplicate_photo_hash', penalty: 30 }, { type: 'impossible_completion_time', penalty: 40 }],
  });
  assert.ok(suspicious.score < clean.score);
});

test('classifyConfidenceLevel buckets scores into the 5 documented tiers', () => {
  assert.equal(classifyConfidenceLevel(95), 'high');
  assert.equal(classifyConfidenceLevel(80), 'medium');
  assert.equal(classifyConfidenceLevel(60), 'low');
  assert.equal(classifyConfidenceLevel(35), 'suspect');
  assert.equal(classifyConfidenceLevel(10), 'conflict');
});

test('getUsagePolicy: trust<60 never enters benchmark or training, per the stated hard rule', () => {
  assert.equal(getUsagePolicy(95).entersBenchmark, true);
  assert.equal(getUsagePolicy(80).entersBenchmark, true);
  assert.equal(getUsagePolicy(80).weight, 0.6);
  assert.equal(getUsagePolicy(59).entersBenchmark, false);
  assert.equal(getUsagePolicy(59).entersTraining, false);
  assert.equal(getUsagePolicy(20).action, 'flag_anomaly_audit');
});

test('conflict matrix registry is queryable and non-empty', () => {
  const rules = listConflictRules();
  assert.ok(rules.length >= 10, 'should have a seed set of at least 10 conflict rules');
  assert.ok(getConflictRule('gps_vs_store_location'));
  assert.equal(getConflictRule('nonexistent_rule'), null);
});
