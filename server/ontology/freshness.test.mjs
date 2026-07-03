import test from 'node:test';
import assert from 'node:assert/strict';

import { checkFreshness, formatFreshnessAlert, runFreshnessCheck } from './freshness.js';

test('checkFreshness flags a source past its staleness threshold', () => {
  const now = new Date('2026-07-03T12:00:00+08:00');
  const sources = [
    { name: 'sales_raw', lastSeenAt: '2026-07-03T10:00:00+08:00', maxStalenessHours: 6 }, // 2h old, fresh
    { name: 'daily_reports', lastSeenAt: '2026-07-01T12:00:00+08:00', maxStalenessHours: 24 }, // 48h old, stale
  ];
  const stale = checkFreshness(sources, now);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].name, 'daily_reports');
  assert.equal(stale[0].hoursStale, 48);
});

test('checkFreshness treats a never-populated source as stale (Infinity)', () => {
  const stale = checkFreshness([{ name: 'ghost_table', lastSeenAt: null, maxStalenessHours: 24 }]);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].hoursStale, Infinity);
});

test('checkFreshness returns empty when everything is fresh', () => {
  const now = new Date('2026-07-03T12:00:00+08:00');
  const stale = checkFreshness(
    [{ name: 'sales_raw', lastSeenAt: '2026-07-03T11:00:00+08:00', maxStalenessHours: 6 }],
    now
  );
  assert.deepEqual(stale, []);
});

test('formatFreshnessAlert renders one line per stale source', () => {
  const text = formatFreshnessAlert(
    [{ name: 'daily_reports', hoursStale: 48, lastSeenAt: '2026-07-01T12:00:00+08:00' }],
    { timeStr: '2026-07-03 12:00:00' }
  );
  assert.match(text, /HRMS 数据新鲜度告警/);
  assert.match(text, /daily_reports.*48 小时无新数据/);
  assert.match(text, /2026-07-03 12:00:00/);
});

test('formatFreshnessAlert calls out a never-populated source distinctly', () => {
  const text = formatFreshnessAlert([{ name: 'ghost_table', hoursStale: Infinity, lastSeenAt: null }]);
  assert.match(text, /从未写入过数据/);
});

test('runFreshnessCheck queries each source and only alerts when something is stale', async () => {
  const calls = [];
  const fakePool = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('sales_raw')) return { rows: [{ last_seen: new Date().toISOString() }] };
      return { rows: [{ last_seen: '2020-01-01T00:00:00Z' }] };
    },
  };
  const { stale, alertText } = await runFreshnessCheck(fakePool, [
    { name: 'sales_raw', table: 'sales_raw', timeColumn: 'date', maxStalenessHours: 24 },
    { name: 'daily_reports', table: 'daily_reports', timeColumn: 'date', maxStalenessHours: 24 },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].name, 'daily_reports');
  assert.match(alertText, /daily_reports/);
});

test('runFreshnessCheck returns null alertText when nothing is stale', async () => {
  const fakePool = { query: async () => ({ rows: [{ last_seen: new Date().toISOString() }] }) };
  const { stale, alertText } = await runFreshnessCheck(fakePool, [
    { name: 'sales_raw', table: 'sales_raw', timeColumn: 'date', maxStalenessHours: 24 },
  ]);
  assert.deepEqual(stale, []);
  assert.equal(alertText, null);
});
