import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCheckinTable } from './checkin-schema-ensure.js';

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

test('ensureCheckinTable: happy path issues extension/table/index DDL', async () => {
  const pool = makePool();
  await ensureCheckinTable(pool);
  assert.ok(pool.calls.some((s) => s.includes('create extension if not exists pgcrypto')));
  assert.ok(pool.calls.some((s) => s.includes('create table if not exists checkin_records')));
  assert.ok(pool.calls.some((s) => s.includes('idx_checkin_username_time')));
  assert.ok(pool.calls.some((s) => s.includes('idx_checkin_store_time')));
  assert.ok(pool.calls.some((s) => s.includes('idx_checkin_time')));
});

test('ensureCheckinTable: swallows DB errors (logs, does not throw)', async () => {
  const pool = makePool({
    onQuery: (sql) => {
      if (sql.includes('create table if not exists checkin_records')) {
        throw new Error('db_unreachable');
      }
      return { rows: [] };
    },
  });
  await assert.doesNotReject(() => ensureCheckinTable(pool));
});
