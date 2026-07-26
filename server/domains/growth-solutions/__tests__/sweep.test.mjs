import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runSolutionSweep,
  startSolutionSweepScheduler,
  __resetSolutionSweepSchedulerForTests,
} from '../sweep.js';

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

test('runSolutionSweep notifies overdue tasks before checking completion', async () => {
  const notifications = [];
  const activeRound = {
    id: 3,
    store: '洪潮店',
    problem_title: '人效',
    round_no: 1,
    status: 'active',
  };
  const getPool = mockPool([
    { rows: [activeRound] },
    {
      rows: [
        {
          title: '每日评分',
          assignee_name: '张三',
          assignee_username: 'zhang',
          due_date: '2026-07-01',
          reminder_count: 2,
        },
      ],
    },
    { rows: [{ open: '1', total: '2' }] },
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
  assert.match(notifications[0], /逾期催促/);
  assert.match(notifications[0], /每日评分/);
  assert.match(notifications[0], /张三/);
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
  assert.match(notifications[0], /达成✅/);
});

test('runSolutionSweep logs review_failed and continues when generateReview throws', async () => {
  const errors = [];
  const observingRound = {
    id: 9,
    store: '洪潮店',
    problem_title: '毛利',
    round_no: 1,
    status: 'observing',
    target_value: 40,
    unit: '%',
  };
  const getPool = mockPool([{ rows: [] }, { rows: [observingRound] }]);

  await runSolutionSweep({
    getPool,
    generateReview: async () => {
      throw new Error('metric boom');
    },
    notify: async () => {},
    log: { error: (p) => errors.push(p) },
  });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].msg, 'review_failed');
  assert.equal(errors[0].round_id, 9);
  assert.match(errors[0].err, /metric boom/);
});

test('startSolutionSweepScheduler arms timers once and swallows sweep errors', async () => {
  __resetSolutionSweepSchedulerForTests();
  const origInterval = global.setInterval;
  const origTimeout = global.setTimeout;
  const scheduled = [];
  global.setInterval = (fn, ms) => {
    scheduled.push({ kind: 'interval', fn, ms });
    return 11;
  };
  global.setTimeout = (fn, ms) => {
    scheduled.push({ kind: 'timeout', fn, ms });
    return 22;
  };
  let calls = 0;
  const runSweep = async () => {
    calls += 1;
    throw new Error('boom');
  };
  try {
    startSolutionSweepScheduler(runSweep);
    startSolutionSweepScheduler(runSweep); // no-op when already armed
    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[0].ms, 6 * 3600 * 1000);
    assert.equal(scheduled[1].ms, 60 * 1000);
    await scheduled[0].fn();
    await scheduled[1].fn();
    assert.equal(calls, 2);
  } finally {
    global.setInterval = origInterval;
    global.setTimeout = origTimeout;
    __resetSolutionSweepSchedulerForTests();
  }
});
