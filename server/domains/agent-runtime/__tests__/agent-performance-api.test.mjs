import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentPerformanceApi } from '../agent-performance-api.js';
import { formatDate } from '../format-date.js';

test('formatDate returns YYYY-MM-DD or empty', () => {
  assert.equal(formatDate(new Date('2026-07-28T12:00:00Z')).length, 10);
  assert.equal(formatDate('not-a-date'), '');
});

test('getAgentPerformanceMetrics merges runtime bags', () => {
  const api = createAgentPerformanceApi({
    performanceMetrics: { totalCalls: 4, cacheHits: 1 },
    agentMessageRuntime: {
      getContextSize: () => 3,
      getCacheSize: () => 2,
      clearCaches: () => {},
      clearExpiredResponseCache: () => 0,
    },
    getAgentQualityMetrics: () => ({ q: 1 }),
    getProviderHealthStatus: () => ({ ok: true }),
    log: { info: () => {} },
    uptime: () => 12.5,
  });
  const m = api.getAgentPerformanceMetrics();
  assert.equal(m.cacheHitRate, '25.00%');
  assert.equal(m.contextSize, 3);
  assert.equal(m.cacheSize, 2);
  assert.deepEqual(m.quality, { q: 1 });
  assert.equal(m.uptime, 12.5);
});

test('clearAgentCache and startExpiredCacheCleanup', () => {
  let cleared = 0;
  let cleaned = 0;
  const logs = [];
  const timers = [];
  const api = createAgentPerformanceApi({
    performanceMetrics: { totalCalls: 0, cacheHits: 0 },
    agentMessageRuntime: {
      getContextSize: () => 0,
      getCacheSize: () => 0,
      clearCaches: () => {
        cleared += 1;
      },
      clearExpiredResponseCache: () => {
        cleaned += 1;
        return 2;
      },
    },
    getProviderHealthStatus: () => ({}),
    log: { info: (...a) => logs.push(a.join(' ')) },
    setIntervalFn: (fn, ms) => {
      timers.push({ fn, ms });
      return 1;
    },
  });
  api.clearAgentCache();
  assert.equal(cleared, 1);
  assert.ok(logs.some((s) => /Cache cleared/.test(s)));
  api.startExpiredCacheCleanup(99);
  assert.equal(timers[0].ms, 99);
  timers[0].fn();
  assert.equal(cleaned, 1);
  assert.ok(logs.some((s) => /Cleaned 2/.test(s)));
});
