import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureDataGovernanceTables } from './data-governance-schema-ensure.js';

function makePool({ onQuery } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(String(sql));
      if (onQuery) return onQuery(String(sql));
      return { rows: [] };
    },
  };
}

test('ensureDataGovernanceTables: happy path creates table then index', async () => {
  const pool = makePool();
  await ensureDataGovernanceTables(pool);
  assert.equal(pool.calls.length, 2);
  assert.ok(pool.calls[0].includes('CREATE TABLE IF NOT EXISTS dish_name_aliases'));
  assert.ok(pool.calls[1].includes('idx_dish_name_aliases_lookup'));
});

test('ensureDataGovernanceTables: propagates DB errors (no swallow)', async () => {
  const pool = makePool({
    onQuery: (sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS dish_name_aliases')) {
        throw new Error('db_unreachable');
      }
      return { rows: [] };
    },
  });
  await assert.rejects(() => ensureDataGovernanceTables(pool), /db_unreachable/);
});
