import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLearning,
  listLearnings,
  seedLearnings,
} from '../learning-service.js';

test('createLearning: rejects missing required fields', async () => {
  await assert.rejects(
    () => createLearning({ query: async () => ({ rows: [] }) }, 'default', {}),
    (err) => err.code === 'missing_fields' && err.status === 400
  );
});

test('createLearning: writes sanitized learning with defaults', async () => {
  let params;
  const result = await createLearning({
    query: async (sql, values) => {
      assert.match(sql, /INSERT INTO growth_learnings/);
      params = values;
      return { rows: [{ id: 9, channel: 'sms' }] };
    },
  }, 'tenant-a', {
    channel: ' sms ',
    variable: ' 文案 ',
    winning_value: ' 个性化 ',
  });

  assert.deepEqual(result, { id: 9, channel: 'sms' });
  assert.equal(params[3], 'sms');
  assert.equal(params[6], '文案');
  assert.equal(params[7], '个性化');
  assert.equal(params[13], 'tenant-a');
});

test('listLearnings: applies filters and clamps limits', async () => {
  const calls = [];
  const pool = {
    query: async (_sql, params) => {
      calls.push(params);
      return { rows: [{ id: 1 }] };
    },
  };
  assert.deepEqual(await listLearnings(pool, { storeCode: 's1', channel: 'sms', limit: 999 }), [{ id: 1 }]);
  await listLearnings(pool, { limit: 0 });
  assert.deepEqual(calls[0], ['s1', 'sms', 200]);
  assert.equal(calls[1][2], 1);
});

test('seedLearnings: inserts every default seed then returns total', async () => {
  let inserts = 0;
  const result = await seedLearnings({
    query: async (sql) => {
      if (sql.includes('INSERT INTO growth_learnings')) {
        inserts += 1;
        return { rows: [] };
      }
      return { rows: [{ cnt: 37 }] };
    },
  }, 'tenant-a');

  assert.ok(inserts >= 30);
  assert.deepEqual(result, { seeded: inserts, total: 37 });
});
