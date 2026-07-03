import test from 'node:test';
import assert from 'node:assert/strict';

import { FRESHNESS_SOURCES } from './freshness-config.js';
import { runFreshnessCheck } from './freshness.js';

test('FRESHNESS_SOURCES entries have the shape runFreshnessCheck expects', () => {
  for (const src of FRESHNESS_SOURCES) {
    assert.equal(typeof src.name, 'string');
    assert.equal(typeof src.table, 'string');
    assert.equal(typeof src.timeColumn, 'string');
    assert.ok(Number.isFinite(src.maxStalenessHours) && src.maxStalenessHours > 0);
  }
});

test('runFreshnessCheck works end-to-end against the real FRESHNESS_SOURCES config with a fake pool', async () => {
  const fakePool = { query: async () => ({ rows: [{ last_seen: new Date().toISOString() }] }) };
  const { stale, alertText } = await runFreshnessCheck(fakePool, FRESHNESS_SOURCES);
  assert.deepEqual(stale, []);
  assert.equal(alertText, null);
});
