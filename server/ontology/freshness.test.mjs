import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFreshness, formatFreshnessAlert, runFreshnessCheck } from './freshness.js';

test('checkFreshness flags missing lastSeenAt as Infinity stale', () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const stale = checkFreshness([{ name: 'pos', lastSeenAt: null, maxStalenessHours: 24 }], now);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].hoursStale, Infinity);
});

test('checkFreshness flags source older than maxStalenessHours', () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const lastSeen = new Date('2026-07-24T12:00:00Z');
  const stale = checkFreshness([{ name: 'crm', lastSeenAt: lastSeen, maxStalenessHours: 24 }], now);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].name, 'crm');
  assert.equal(stale[0].hoursStale, 48);
});

test('checkFreshness returns empty when within threshold', () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const lastSeen = new Date('2026-07-26T10:00:00Z');
  const stale = checkFreshness([{ name: 'ok', lastSeenAt: lastSeen, maxStalenessHours: 24 }], now);
  assert.deepEqual(stale, []);
});

test('formatFreshnessAlert includes source lines and custom timeStr', () => {
  const text = formatFreshnessAlert(
    [{ name: 'pos', hoursStale: 30, lastSeenAt: '2026-07-25' }],
    { timeStr: '2026-07-26 20:00:00' }
  );
  assert.match(text, /数据新鲜度告警/);
  assert.match(text, /pos/);
  assert.match(text, /30 小时无新数据/);
  assert.match(text, /2026-07-26 20:00:00/);
});

test('formatFreshnessAlert handles never-written source', () => {
  const text = formatFreshnessAlert([{ name: 'x', hoursStale: Infinity, lastSeenAt: null }]);
  assert.match(text, /从未写入过数据/);
});

test('runFreshnessCheck queries pool and builds alert when stale', async () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const pool = {
    query: async (sql) => {
      assert.match(sql, /MAX\(updated_at\)/);
      return { rows: [{ last_seen: '2026-07-20T12:00:00Z' }] };
    },
  };
  const defs = [{ name: 'pos_orders', table: 'pos_order_items', timeColumn: 'updated_at', maxStalenessHours: 24 }];
  const { stale, alertText } = await runFreshnessCheck(pool, defs, now);
  assert.equal(stale.length, 1);
  assert.ok(alertText);
});

test('runFreshnessCheck returns null alertText when fresh', async () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const pool = { query: async () => ({ rows: [{ last_seen: now.toISOString() }] }) };
  const defs = [{ name: 'fresh', table: 't', timeColumn: 'updated_at', maxStalenessHours: 48 }];
  const { stale, alertText } = await runFreshnessCheck(pool, defs, now);
  assert.deepEqual(stale, []);
  assert.equal(alertText, null);
});
