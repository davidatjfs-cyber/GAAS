import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReview } from '../review.js';

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

const baseRound = {
  id: 5,
  store: '洪潮店',
  problem_key: 'revenue',
  metric_key: 'revenue',
  problem_title: '营业额',
  metric_label: '近30天营业额',
  unit: '元',
  baseline_value: 100000,
  target_value: 120000,
};

test('generateReview marks success when achievement rate >= 90%', async () => {
  const computeMetric = async () => ({ value: 110000, detail: {} });
  const getPool = mockPool([
    {
      rows: [
        {
          title: '开启营销',
          assignee_name: '张三',
          assignee_username: 'zhang',
          status: 'done',
          done_at: '2026-07-10T10:00:00Z',
          due_date: '2026-07-10',
          reminder_count: 0,
        },
      ],
    },
  ]);
  const review = await generateReview(getPool, computeMetric, () => null, baseRound);
  assert.equal(review.success, true);
  assert.equal(review.actual_value, 110000);
  assert.equal(review.achievement_rate, 0.9167);
});

test('generateReview marks failure when achievement rate < 90%', async () => {
  const computeMetric = async () => ({ value: 90000, detail: {} });
  const getPool = mockPool([
    {
      rows: [
        {
          title: '开启营销',
          assignee_name: '张三',
          assignee_username: 'zhang',
          status: 'done',
          done_at: '2026-07-10T10:00:00Z',
          due_date: '2026-07-10',
          reminder_count: 0,
        },
      ],
    },
  ]);
  const review = await generateReview(getPool, computeMetric, () => null, baseRound);
  assert.equal(review.success, false);
  assert.equal(review.actual_value, 90000);
  assert.equal(review.achievement_rate, 0.75);
});

test('generateReview uses count-type actual as baseline minus current metric', async () => {
  const countRound = {
    ...baseRound,
    problem_key: 'menu_optimization',
    metric_key: 'menu_optimization',
    problem_title: '菜单优化',
    metric_label: '问题菜品数',
    unit: '道',
    baseline_value: 12,
    target_value: 5,
  };
  const computeMetric = async () => ({ value: 8, detail: { complaint_dishes: [] } });
  const getPool = mockPool([{ rows: [] }]);
  const review = await generateReview(getPool, computeMetric, () => null, countRound);
  assert.equal(review.actual_value, 4);
  assert.equal(review.success, false);
  assert.equal(review.achievement_rate, 0.8);
});
