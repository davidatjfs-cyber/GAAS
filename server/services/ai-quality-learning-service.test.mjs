import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateReleaseGate,
  redactLearningText,
  shouldRollbackCanary,
} from './ai-quality-learning-service.js';

test('redactLearningText removes direct identifiers and secrets', () => {
  const source = '手机 13812345678，邮箱 boss@example.com，身份证 110101199001011234，api_key=sk-live-secret';
  const result = redactLearningText(source);
  assert.equal(result.text.includes('13812345678'), false);
  assert.equal(result.text.includes('boss@example.com'), false);
  assert.equal(result.text.includes('110101199001011234'), false);
  assert.equal(result.text.includes('sk-live-secret'), false);
  assert.equal(result.report.replacements.phone, 1);
  assert.equal(result.report.replacements.email, 1);
  assert.equal(result.report.replacements.id_card, 1);
  assert.equal(result.report.replacements.secret, 1);
});

test('release gate requires diverse evidence and a measurable quality lift', () => {
  const baseline = {
    quality_score: 0.80,
    groundedness: 0.91,
    safety_violation_rate: 0.005,
    negative_feedback_rate: 0.12,
    p95_latency_ms: 1000,
  };
  const candidate = {
    sample_size: 180,
    tenant_count: 4,
    quality_score: 0.84,
    groundedness: 0.93,
    safety_violation_rate: 0.004,
    negative_feedback_rate: 0.09,
    p95_latency_ms: 1120,
  };
  assert.equal(evaluateReleaseGate(baseline, candidate).passed, true);
  assert.equal(evaluateReleaseGate(baseline, { ...candidate, tenant_count: 1 }).passed, false);
  assert.equal(evaluateReleaseGate(baseline, { ...candidate, quality_score: 0.81 }).passed, false);
});

test('canary rollback reacts to safety, feedback and quality regressions', () => {
  const baseline = {
    quality_score: 0.84,
    safety_violation_rate: 0.002,
    negative_feedback_rate: 0.08,
    error_rate: 0.01,
  };
  assert.equal(shouldRollbackCanary(baseline, {
    quality_score: 0.85,
    safety_violation_rate: 0.002,
    negative_feedback_rate: 0.09,
    error_rate: 0.01,
  }).rollback, false);
  const unsafe = shouldRollbackCanary(baseline, {
    quality_score: 0.79,
    safety_violation_rate: 0.004,
    negative_feedback_rate: 0.14,
    error_rate: 0.03,
  });
  assert.equal(unsafe.rollback, true);
  assert.deepEqual(new Set(unsafe.reasons.map((item) => item.key)), new Set([
    'safety_violation_rate', 'negative_feedback_rate', 'error_rate', 'quality_score',
  ]));
});
