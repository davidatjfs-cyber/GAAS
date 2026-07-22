import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesConversionReadiness } from './sales-boss-metrics.js';
import { listObjectionConversionStats } from './sales-store.js';

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

test('异议转化统计只看异议之后30天内的阶段变化，并正确计算转化率', async () => {
  let capturedSql = '';
  let capturedParams = null;
  const pool = {
    async query(sql, params) {
      capturedSql = String(sql);
      capturedParams = params;
      return {
        rows: [
          { objection_key: 'price_too_high', objection_label: '价格太高', raised_count: 10, converted_count: 3 },
          { objection_key: 'too_complex', objection_label: '系统太复杂', raised_count: 4, converted_count: 0 },
        ],
      };
    },
  };
  const stats = await listObjectionConversionStats(pool, { days: 30, limit: 20 });
  assert.match(capturedSql, /FROM sales_objections o/);
  assert.match(capturedSql, /h\.created_at > o\.created_at/);
  assert.match(capturedSql, /to_stage IN \('trial','won'\)/);
  assert.deepEqual(capturedParams, [20, 30]);
  assert.deepEqual(stats.map((s) => s.conversion_rate), [30, 0]);
  assert.equal(stats[0].objection_key, 'price_too_high');
});
