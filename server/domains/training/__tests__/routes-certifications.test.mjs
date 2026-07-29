import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCertificationReviewDecision,
  PRACTICE_CERT_PASS_SCORE,
} from '../routes-certifications.js';

const baseCert = {
  ai_verdict: 'failed',
  ai_total_score: null,
  ai_step_scores: [],
};

test('resolveCertificationReviewDecision: verdict passed without AI score defaults to 85', () => {
  const d = resolveCertificationReviewDecision(baseCert, { verdict: 'passed' });
  assert.equal(d.ok, true);
  assert.equal(d.passed, true);
  assert.equal(d.finalScore, 85);
});

test('resolveCertificationReviewDecision: override empty steps rejected', () => {
  const d = resolveCertificationReviewDecision(baseCert, { action: 'override', steps: [] });
  assert.equal(d.ok, false);
  assert.match(d.error, /请填写评分/);
});

test('resolveCertificationReviewDecision: override total 85 passes', () => {
  const d = resolveCertificationReviewDecision(baseCert, {
    action: 'override',
    steps: [{ name: '综合', score: 85, max: 100 }],
  });
  assert.equal(d.ok, true);
  assert.equal(d.passed, true);
});

test('PRACTICE_CERT_PASS_SCORE is 80', () => {
  assert.equal(PRACTICE_CERT_PASS_SCORE, 80);
});
