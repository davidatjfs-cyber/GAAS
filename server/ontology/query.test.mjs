import test from 'node:test';
import assert from 'node:assert/strict';

import { buildObjectQuery, clampLimit, queryObject } from './query.js';

test('clampLimit falls back to default on invalid input', () => {
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit(-5), 50);
  assert.equal(clampLimit('abc'), 50);
});

test('clampLimit caps at MAX_LIMIT', () => {
  assert.equal(clampLimit(9999), 200);
});

test('clampLimit passes through valid values', () => {
  assert.equal(clampLimit(10), 10);
});

test('buildObjectQuery without id lists the table', () => {
  const { sql, params } = buildObjectQuery('store', { limit: 10 });
  assert.equal(sql, 'SELECT * FROM stores LIMIT $1');
  assert.deepEqual(params, [10]);
});

test('buildObjectQuery with id filters by the object keyField', () => {
  const { sql, params } = buildObjectQuery('store', { id: '洪潮大宁久光店' });
  assert.equal(sql, 'SELECT * FROM stores WHERE name = $1 LIMIT $2');
  assert.deepEqual(params, ['洪潮大宁久光店', 50]);
});

test('buildObjectQuery rejects unknown object types (whitelist)', () => {
  assert.throws(() => buildObjectQuery('drop_table_students'), /unknown object type/);
});

test('queryObject delegates to pool.query with the built statement', async () => {
  const calls = [];
  const fakePool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ ok: true }] };
    },
  };
  const rows = await queryObject(fakePool, 'employee', { id: 'zhangsan' });
  assert.deepEqual(rows, [{ ok: true }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, 'SELECT * FROM employees WHERE username = $1 LIMIT $2');
  assert.deepEqual(calls[0].params, ['zhangsan', 50]);
});
