import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPercent,
  getAbTemplate,
  listLearnings,
  listPriceTests,
  sanitizeFields,
  seedLearnings,
  stableVariant,
} from '../service.js';

test('getAbTemplate: unknown key returns null', () => {
  assert.equal(getAbTemplate('not-a-real-template'), null);
  assert.equal(getAbTemplate('sms')?.key, 'sms');
});

test('stableVariant: deterministic for same seed', () => {
  assert.equal(stableVariant('task:1:13800000000'), stableVariant('task:1:13800000000'));
  assert.equal(stableVariant('a'), stableVariant('a'));
  assert.ok(['A', 'B'].includes(stableVariant('seed-x')));
});

test('sanitizeFields: trims and caps field count', () => {
  const fields = sanitizeFields([
    { key: ' sent ', label: '发送量', type: 'int' },
    { key: 'bad key!', label: '坏键', type: 'int' },
    { label: '无键', type: 'money' },
  ]);
  assert.equal(fields.length, 3);
  assert.equal(fields[0].key, 'sent');
  assert.equal(fields[0].type, 'int');
  assert.equal(fields[2].type, 'money');
  assert.equal(sanitizeFields(Array.from({ length: 20 }, (_, i) => ({ key: `f${i}`, label: `F${i}` }))).length, 12);
});

test('formatPercent: non-finite falls back to 0.00%', () => {
  assert.equal(formatPercent(NaN), '0.00%');
  assert.equal(formatPercent(12.345, 1), '12.3%');
  assert.equal(formatPercent(0.5), '0.50%');
});

test('listPriceTests: status filter passed to query', async () => {
  const calls = [];
  const pool = {
    async query(_sql, params) {
      calls.push(params);
      return { rows: [] };
    },
  };
  await listPriceTests(pool, 'default', { storeCode: '51866138', status: 'running' });
  assert.equal(calls[0][0], '51866138');
  assert.equal(calls[0][1], 'running');
  assert.equal(calls[0][2], 'default');
});

test('listLearnings: limit clamped to 1..200', async () => {
  const calls = [];
  const pool = {
    async query(_sql, params) {
      calls.push(params);
      return { rows: [] };
    },
  };
  await listLearnings(pool, { limit: 9999 });
  assert.equal(calls[0][2], 200);
  await listLearnings(pool, { limit: 0 });
  assert.equal(calls[1][2], 1);
});

test('seedLearnings: returns seeded count and total', async () => {
  let insertCount = 0;
  const pool = {
    async query(sql) {
      if (sql.includes('INSERT INTO growth_learnings')) {
        insertCount += 1;
        return { rows: [] };
      }
      if (sql.includes('COUNT(*)')) return { rows: [{ cnt: 42 }] };
      return { rows: [] };
    },
  };
  const result = await seedLearnings(pool, 'default');
  assert.equal(result.seeded, insertCount);
  assert.ok(result.seeded >= 30);
  assert.equal(result.total, 42);
});
