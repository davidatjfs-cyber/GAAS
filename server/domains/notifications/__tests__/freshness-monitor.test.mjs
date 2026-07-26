import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreshnessMonitorScheduler } from '../scheduler-freshness.js';

const SOURCES = [{ name: 'pos', table: 'pos_order_items' }];

function makeScheduler(overrides = {}) {
  const queryCalls = [];
  const sends = [];
  const checkCalls = [];
  let continueOnError;

  const deps = {
    pool: {
      query: async (sql) => {
        queryCalls.push(sql);
        return { rows: [{ open_id: 'ou_admin' }] };
      },
    },
    runForActiveTenants: async (fn, opts) => {
      continueOnError = opts?.continueOnError;
      await fn('default');
    },
    runFreshnessCheck: async () => {
      checkCalls.push(1);
      return {
        stale: [{ name: 'pos' }],
        alertText: '⚠️ stale pos',
      };
    },
    FRESHNESS_SOURCES: SOURCES,
    sendLarkMessage: async (openId, text, opts) => {
      sends.push({ openId, text, opts });
      return { ok: true };
    },
    ...overrides,
  };

  const api = createFreshnessMonitorScheduler(deps);
  return { ...api, queryCalls, sends, checkCalls, getContinueOnError: () => continueOnError };
}

test('skips second tick same day for same tenant (Map)', async () => {
  const { runFreshnessMonitorTick, checkCalls, sends, getContinueOnError } = makeScheduler();

  await runFreshnessMonitorTick();
  await runFreshnessMonitorTick();

  assert.equal(getContinueOnError(), true);
  assert.equal(checkCalls.length, 1);
  assert.equal(sends.length, 1);
});

test('when alertText empty, does not query feishu_users / send', async () => {
  let checkCalls = 0;
  const { runFreshnessMonitorTick, queryCalls, sends } = makeScheduler({
    runFreshnessCheck: async () => {
      checkCalls += 1;
      return { stale: [], alertText: null };
    },
  });

  await runFreshnessMonitorTick();

  assert.equal(checkCalls, 1);
  assert.equal(queryCalls.length, 0);
  assert.equal(sends.length, 0);
});

test('when stale + recipients, calls sendLarkMessage', async () => {
  const { runFreshnessMonitorTick, sends, queryCalls } = makeScheduler();

  await runFreshnessMonitorTick();

  assert.equal(queryCalls.length, 1);
  assert.match(queryCalls[0], /feishu_users/);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].openId, 'ou_admin');
  assert.equal(sends[0].text, '⚠️ stale pos');
  assert.equal(sends[0].opts?.skipDedup, true);
});

test('no recipients → returns without send', async () => {
  const { runFreshnessMonitorTick, sends } = makeScheduler({
    pool: {
      query: async () => ({ rows: [] }),
    },
  });

  await runFreshnessMonitorTick();

  assert.equal(sends.length, 0);
});

test('startFreshnessMonitorScheduler is idempotent', () => {
  const realSetTimeout = global.setTimeout;
  const realSetInterval = global.setInterval;
  const timeouts = [];
  const intervals = [];
  global.setTimeout = (fn, ms) => {
    const id = realSetTimeout(() => {}, 60_000);
    timeouts.push({ ms, id });
    return id;
  };
  global.setInterval = (fn, ms) => {
    const id = realSetInterval(() => {}, 60_000);
    intervals.push({ ms, id });
    return id;
  };
  try {
    const { startFreshnessMonitorScheduler } = makeScheduler();
    startFreshnessMonitorScheduler();
    startFreshnessMonitorScheduler();
    assert.equal(timeouts.length, 1);
    assert.equal(timeouts[0].ms, 90000);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].ms, 6 * 3600 * 1000);
  } finally {
    for (const t of timeouts) clearTimeout(t.id);
    for (const i of intervals) clearInterval(i.id);
    global.setTimeout = realSetTimeout;
    global.setInterval = realSetInterval;
  }
});
