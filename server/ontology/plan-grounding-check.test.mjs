import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenKnownNumbers,
  checkPlanGrounding,
  checkTextGrounding,
} from './plan-grounding-check.js';

const storeHealth = {
  healthScore: 72,
  scoreBreakdown: { anomalyDeduct: 5, materialDeduct: 8, closingDeduct: 3, complaintDeduct: 2 },
  anomalies: [{ count: 4 }],
  materialIssues: [{ count: 2 }],
  inspections: { closingTotal: 10, closingPassed: 9 },
  complaints: { tableVisitTotal: 50, withComplaints: 3 },
};

test('flattenKnownNumbers collects all numeric fields', () => {
  const nums = flattenKnownNumbers(storeHealth);
  for (const n of [72, 5, 8, 3, 2, 4, 2, 10, 9, 50, 3]) {
    assert.ok(nums.has(n), `expected ${n}`);
  }
});

test('checkPlanGrounding passes when claims match known numbers', () => {
  const result = checkPlanGrounding(
    { summary: '原料维度扣8分，收档检查10次', rootCauses: ['异常4次'] },
    storeHealth
  );
  assert.equal(result.passed, true);
  assert.deepEqual(result.unverifiedClaims, []);
});

test('checkPlanGrounding fails on fabricated numbers', () => {
  const result = checkPlanGrounding(
    { summary: '原料维度扣32分', rootCauses: ['收档检查469次'] },
    storeHealth
  );
  assert.equal(result.passed, false);
  assert.equal(result.unverifiedClaims.length, 2);
  assert.equal(result.unverifiedClaims[0].raw, '32分');
});

test('checkTextGrounding validates arbitrary text against known set', () => {
  const ok = checkTextGrounding('完成5次检查', [5, 10]);
  assert.equal(ok.passed, true);

  const bad = checkTextGrounding('扣99分', new Set([5, 10]));
  assert.equal(bad.passed, false);
  assert.equal(bad.unverifiedClaims[0].raw, '99分');
});

test('checkPlanGrounding handles empty planData', () => {
  const result = checkPlanGrounding({}, storeHealth);
  assert.equal(result.passed, true);
});
