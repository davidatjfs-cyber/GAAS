import test from 'node:test';
import assert from 'node:assert/strict';

import { checkPlanGrounding, flattenKnownNumbers } from './plan-grounding-check.js';

const realStoreHealth = {
  healthScore: 30,
  scoreBreakdown: { anomalyDeduct: 10, materialDeduct: 5, closingDeduct: 0, complaintDeduct: 0 },
  anomalies: [{ category: '原料', severity: 'high', count: 2 }],
  materialIssues: [{ material: '胸口油', count: 2 }],
  inspections: { closingTotal: 0, closingPassed: 0 },
  complaints: { tableVisitTotal: 0, withComplaints: 0 },
};

test('flattenKnownNumbers pulls every real number out of storeHealth', () => {
  const known = flattenKnownNumbers(realStoreHealth);
  assert.ok(known.has(30)); // healthScore
  assert.ok(known.has(10)); // anomalyDeduct
  assert.ok(known.has(2));  // anomaly count / material issue count
});

test('rejects the real fabricated claim from AP-mm4aim3q (原料维度扣32分 — 32 never appears in real data)', () => {
  const planData = {
    summary: '门店健康分低主要因原料维度扣32分、收档维度扣15分',
    rootCauses: ['近30天累计发生12次原料严重问题'],
  };
  const result = checkPlanGrounding(planData, realStoreHealth);
  assert.equal(result.passed, false);
  const raws = result.unverifiedClaims.map(c => c.raw);
  assert.ok(raws.includes('32分'));
  assert.ok(raws.includes('15分'));
  assert.ok(raws.includes('12次'));
});

test('rejects the real fabricated claim from AP-mm3h7o03 (异常任务扣21分)', () => {
  const planData = { summary: '主要扣分项为异常任务（扣21分）', rootCauses: [] };
  const result = checkPlanGrounding(planData, realStoreHealth);
  assert.equal(result.passed, false);
  assert.equal(result.unverifiedClaims[0].raw, '21分');
});

test('passes when every claimed number traces back to real storeHealth data', () => {
  const planData = {
    summary: '健康分30分偏低，异常任务扣10分是主因',
    rootCauses: ['原料问题出现2次，涉及胸口油'],
  };
  const result = checkPlanGrounding(planData, realStoreHealth);
  assert.deepEqual(result, { passed: true, unverifiedClaims: [] });
});

test('ignores non-claim numbers like deadlines (not 分/次 suffixed)', () => {
  const planData = { summary: '7天内完成整改，目标健康分30分', rootCauses: [] };
  const result = checkPlanGrounding(planData, realStoreHealth);
  assert.equal(result.passed, true);
});

test('handles missing/empty planData and storeHealth without throwing', () => {
  assert.deepEqual(checkPlanGrounding({}, {}), { passed: true, unverifiedClaims: [] });
  assert.deepEqual(checkPlanGrounding(undefined, undefined), { passed: true, unverifiedClaims: [] });
});
