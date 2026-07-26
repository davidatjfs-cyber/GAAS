/**
 * domains/ops-tasks/scheduler.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpsTaskScheduler } from '../scheduler.js';

test('runOpsTaskSchedulerTick：ensure + overdue update；租户内错误吞掉', async () => {
  const calls = { ensureTable: 0, ensureDate: [], queries: 0 };
  const { runOpsTaskSchedulerTick } = createOpsTaskScheduler({
    pool: {
      query: async () => {
        calls.queries += 1;
        return {};
      },
    },
    runForActiveTenants: async (fn) => {
      await fn('t1');
      await fn('t2');
    },
    ensureOpsTasksTable: async () => {
      calls.ensureTable += 1;
      if (calls.ensureTable === 2) throw new Error('boom');
    },
    opsDateOnly: () => '2026-07-26',
    ensureOpsTasksForDate: async (d) => {
      calls.ensureDate.push(d);
    },
  });
  await runOpsTaskSchedulerTick();
  assert.equal(calls.ensureTable, 2);
  assert.deepEqual(calls.ensureDate, ['2026-07-26']);
  assert.equal(calls.queries, 1);
});

test('runOpsTaskSchedulerTick：runForActiveTenants 外层失败不抛', async () => {
  const { runOpsTaskSchedulerTick } = createOpsTaskScheduler({
    pool: { query: async () => ({}) },
    runForActiveTenants: async () => {
      throw new Error('outer');
    },
    ensureOpsTasksTable: async () => {},
    opsDateOnly: () => '2026-07-26',
    ensureOpsTasksForDate: async () => {},
  });
  await runOpsTaskSchedulerTick();
});

test('startOpsTaskScheduler 幂等', async () => {
  let ticks = 0;
  const timers = [];
  const realSetInterval = global.setInterval;
  global.setInterval = (fn, ms) => {
    timers.push({ fn, ms });
    return 1;
  };
  try {
    const { startOpsTaskScheduler, runOpsTaskSchedulerTick } = createOpsTaskScheduler({
      pool: { query: async () => ({}) },
      runForActiveTenants: async (fn) => {
        ticks += 1;
        await fn('t');
      },
      ensureOpsTasksTable: async () => {},
      opsDateOnly: () => '2026-07-26',
      ensureOpsTasksForDate: async () => {},
    });
    startOpsTaskScheduler();
    startOpsTaskScheduler();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(ticks, 1);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 60_000);
    // keep unused export referenced
    assert.equal(typeof runOpsTaskSchedulerTick, 'function');
  } finally {
    global.setInterval = realSetInterval;
  }
});
