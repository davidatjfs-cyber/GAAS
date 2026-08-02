import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreshnessMonitorScheduler } from '../scheduler-freshness.js';

const SOURCES = [{ name: 'pos', table: 'pos_order_items' }];

function makeScheduler(overrides = {}) {
  const queryCalls = [];
  const sends = [];
  const checkCalls = [];
  let continueOnError;
  const heartbeatStore = new Map();

  const deps = {
    pool: {
      query: async (sql, params) => {
        queryCalls.push(sql);
        if (/FROM scheduler_heartbeat/.test(sql)) {
          const lastBeat = heartbeatStore.get(params?.[0]);
          return { rows: lastBeat ? [{ last_beat: lastBeat }] : [] };
        }
        if (/INSERT INTO scheduler_heartbeat/.test(sql)) {
          heartbeatStore.set(params?.[0], new Date());
          return { rows: [] };
        }
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

test('skips second tick same day for same tenant', async () => {
  const { runFreshnessMonitorTick, checkCalls, sends, getContinueOnError } = makeScheduler();

  await runFreshnessMonitorTick();
  await runFreshnessMonitorTick();

  assert.equal(getContinueOnError(), true);
  assert.equal(checkCalls.length, 1);
  assert.equal(sends.length, 1);
});

// 2026-08-02：用户反馈告警每隔几十分钟重复来一次——根因是"今天是否已发送"的去重原来
// 存在进程内存Map里，pm2 restart会清零。锁定：去重必须落库(scheduler_heartbeat)，
// 不能是新建一个scheduler实例(模拟进程重启)之后就又能发一次。
test('重启后(新建scheduler实例，模拟pm2 restart)仍然记得今天已经发送过，不会重复告警', async () => {
  let checkCalls = 0;
  const heartbeatStore = new Map();
  const sends = [];
  const makeDeps = () => ({
    pool: {
      query: async (sql, params) => {
        if (/FROM scheduler_heartbeat/.test(sql)) {
          const lastBeat = heartbeatStore.get(params?.[0]);
          return { rows: lastBeat ? [{ last_beat: lastBeat }] : [] };
        }
        if (/INSERT INTO scheduler_heartbeat/.test(sql)) {
          heartbeatStore.set(params?.[0], new Date());
          return { rows: [] };
        }
        return { rows: [{ open_id: 'ou_admin' }] };
      },
    },
    runForActiveTenants: async (fn) => { await fn('default'); },
    runFreshnessCheck: async () => {
      checkCalls += 1;
      return { stale: [{ name: 'pos' }], alertText: '⚠️ stale pos' };
    },
    FRESHNESS_SOURCES: SOURCES,
    sendLarkMessage: async (openId, text, opts) => { sends.push({ openId, text, opts }); return { ok: true }; },
  });

  const scheduler1 = createFreshnessMonitorScheduler(makeDeps());
  await scheduler1.runFreshnessMonitorTick();

  // 模拟pm2 restart：新建一个scheduler实例(进程内存全部重置)，但heartbeatStore代表
  // 数据库持久化状态，跨"重启"仍然存在。
  const scheduler2 = createFreshnessMonitorScheduler(makeDeps());
  await scheduler2.runFreshnessMonitorTick();

  assert.equal(checkCalls, 1, '第二次(重启后)应该被去重挡住，不再重新检查/发送');
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
  assert.ok(!queryCalls.some((sql) => /feishu_users/.test(sql)), '不应该查feishu_users');
  assert.equal(sends.length, 0);
});

test('when stale + recipients, calls sendLarkMessage', async () => {
  const { runFreshnessMonitorTick, sends, queryCalls } = makeScheduler();

  await runFreshnessMonitorTick();

  assert.equal(queryCalls.filter((sql) => /feishu_users/.test(sql)).length, 1);
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
