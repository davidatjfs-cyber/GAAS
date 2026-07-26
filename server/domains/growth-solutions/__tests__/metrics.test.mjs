import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrowthSolutionMetrics } from '../metrics.js';

function mockPool(handlers) {
  let callIndex = 0;
  return () => ({
    query: async (sql, params) => {
      const handler = handlers[callIndex];
      callIndex += 1;
      if (typeof handler === 'function') return handler(sql, params);
      if (handler) return handler;
      throw new Error(`unexpected query #${callIndex}: ${String(sql).slice(0, 80)}`);
    },
  });
}

test('computeMetric staff_efficiency aggregates revenue and person-days', async () => {
  const { computeMetric } = createGrowthSolutionMetrics({
    pool: mockPool([
      {
        rows: [
          { pre_discount_revenue: 10000, staff: { front: [{ days: 5 }, { days: 3 }] } },
          { pre_discount_revenue: 5000, staff: { kitchen: [{ days: 2 }] } },
        ],
      },
    ]),
  });
  const out = await computeMetric('staff_efficiency', '马己仙店', '2026-07-01', '2026-07-30');
  assert.equal(out.value, 1500);
  assert.equal(out.detail.pre_discount_revenue, 15000);
  assert.equal(out.detail.person_days, 10);
  assert.equal(out.detail.days, 2);
});

test('computeMetric revenue sums daily reports and churn predictions', async () => {
  const { computeMetric } = createGrowthSolutionMetrics({
    pool: mockPool([
      { rows: [{ rev: 250000, days: 28 }] },
      {
        rows: [
          { risk_level: 'high', n: 3 },
          { risk_level: 'medium', n: 5 },
        ],
      },
    ]),
  });
  const out = await computeMetric('revenue', '马己仙旗舰店', '2026-07-01', '2026-07-30');
  assert.equal(out.value, 250000);
  assert.equal(out.detail.days, 28);
  assert.equal(out.detail.sleeping_high, 3);
  assert.equal(out.detail.sleeping_medium, 5);
  assert.equal(out.detail.sleeping_customers, 8);
});

test('computeMetric kitchen_standard computes punch completion rate', async () => {
  const { computeMetric } = createGrowthSolutionMetrics({
    pool: mockPool([
      { rows: [{ scheduled_times: ['09:00', '12:00'] }, { scheduled_times: '18:00' }] },
      { rows: [{ n: 6 }] },
    ]),
  });
  const out = await computeMetric('kitchen_standard', '洪潮店', '2026-07-01', '2026-07-03');
  assert.equal(out.detail.expected, 9);
  assert.equal(out.detail.confirmed, 6);
  assert.equal(out.value, 66.67);
});

test('computeMetric training_replication calculates certification coverage', async () => {
  const { computeMetric } = createGrowthSolutionMetrics({
    pool: mockPool([
      { rows: [{ username: 'u1', name: '张三', position: '服务员' }] },
      { rows: [{ id: 1, title: '服务基础', position: '服务员' }] },
      { rows: [{ employee_username: 'u1', topic_id: 1 }] },
    ]),
  });
  const out = await computeMetric('training_replication', '洪潮店', '2026-07-01', '2026-07-30');
  assert.equal(out.value, 100);
  assert.equal(out.detail.required, 1);
  assert.equal(out.detail.covered, 1);
  assert.equal(out.detail.gap_count, 0);
});

test('computeMetric rejects unknown problem_key', async () => {
  const { computeMetric } = createGrowthSolutionMetrics({ pool: mockPool([]) });
  await assert.rejects(
    () => computeMetric('not_a_problem', '洪潮店', '2026-07-01', '2026-07-30'),
    /unknown problem_key/
  );
});

test('metricGrossMargin uses dish aggregates and cost map', async () => {
  const { metricGrossMargin } = createGrowthSolutionMetrics({
    pool: mockPool([
      {
        rows: [
          { dish_name: '牛肉', category: '主菜', biz_type: '堂食', qty: 10, revenue: 1000 },
        ],
      },
      {
        rows: [{ dish_name: '牛肉', unit_cost: 50, biz_type: '堂食' }],
      },
    ]),
  });
  const out = await metricGrossMargin('洪潮店', '2026-07-01', '2026-07-30');
  assert.equal(out.value, 50);
  assert.equal(out.detail.matched_dishes, 1);
  assert.equal(out.detail.low_margin_top[0].dish, '牛肉');
});
