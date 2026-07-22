import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesConversionReadiness } from './sales-boss-metrics.js';

test('转化就绪度把无人接管和无授权案例标记为明确阻塞项', () => {
  const readiness = buildSalesConversionReadiness({
    active_reps: 0,
    active_knowledge: 20,
    approved_assets: 1,
    auto_assets: 0,
    approved_cases: 0,
    tracking_ready: true,
  });
  assert.equal(readiness.score, 45);
  assert.equal(readiness.status, 'blocked');
  assert.deepEqual(readiness.blockers.map((item) => item.key), ['human_handoff', 'approved_case', 'nurture_content']);
  assert.match(readiness.blockers[0].impact, /高意向客户/);
});
