import test from 'node:test';
import assert from 'node:assert/strict';
import { runSolutionSweep } from '../sweep.js';

function mockPool(handlers) {
  let callIndex = 0;
  const pool = {
    query: async (sql, params) => {
      const handler = handlers[callIndex];
      callIndex += 1;
      if (typeof handler === 'function') return handler(sql, params);
      if (handler) return handler;
      throw new Error(`unexpected query #${callIndex}: ${String(sql).slice(0, 80)}`);
    },
  };
  return () => pool;
}

test('runSolutionSweep transitions active round to observing when all tasks done', async () => {
  const notifications = [];
  const activeRound = {
    id: 1,
    store: '洪潮店',
    problem_title: '营业额',
    round_no: 1,
    status: 'active',
  };
  const getPool = mockPool([
    { rows: [activeRound] },
    { rows: [] },
    { rows: [{ open: '0', total: '3' }] },
    (sql) => {
      assert.match(sql, /status='observing'/);
      return { rows: [] };
    },
    { rows: [] },
  ]);

  await runSolutionSweep({
    getPool,
    generateReview: async () => ({ actual_value: 0, achievement_rate: 0, success: false, report: {} }),
    notify: async (msg) => {
      notifications.push(msg);
    },
    log: { error: () => {} },
  });

  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /进入30天观察期/);
});

test('runSolutionSweep transitions observing round to reviewing with review data', async () => {
  const notifications = [];
  const observingRound = {
    id: 2,
    store: '马己仙店',
    problem_title: '人效',
    round_no: 2,
    status: 'observing',
    target_value: 100,
    unit: '元',
    measure_end_date: '2026-07-01',
  };
  const reviewPayload = {
    actual_value: 95,
    achievement_rate: 0.95,
    success: true,
    report: { success: true },
  };
  const getPool = mockPool([
    { rows: [] },
    { rows: [observingRound] },
    (sql, params) => {
      assert.match(sql, /status='reviewing'/);
      assert.deepEqual(params, [observingRound.id, 95, 0.95, JSON.stringify(reviewPayload.report)]);
      return { rows: [] };
    },
  ]);

  await runSolutionSweep({
    getPool,
    generateReview: async () => reviewPayload,
    notify: async (msg) => {
      notifications.push(msg);
    },
    log: { error: () => {} },
  });

  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /复盘/);
});
