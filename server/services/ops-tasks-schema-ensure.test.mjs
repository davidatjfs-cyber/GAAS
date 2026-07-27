import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureOpsTasksTable } from './ops-tasks-schema-ensure.js';

function makePool({ onQuery } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push(String(sql));
      if (onQuery) return onQuery(String(sql), params);
      return { rows: [] };
    },
  };
}

test('ensureOpsTasksTable: happy path issues extension/table/index DDL', async () => {
  const pool = makePool();
  await ensureOpsTasksTable(pool);
  assert.ok(pool.calls.some((s) => s.includes('create extension if not exists pgcrypto')));
  assert.ok(pool.calls.some((s) => s.includes('create table if not exists ops_tasks')));
  assert.ok(pool.calls.some((s) => s.includes('idx_ops_tasks_assignee_status')));
  assert.ok(pool.calls.some((s) => s.includes('idx_ops_tasks_store_date')));
  assert.ok(pool.calls.some((s) => s.includes('idx_ops_tasks_due')));
});

test('ensureOpsTasksTable: swallows "already exists" races', async () => {
  const pool = makePool({
    onQuery: (sql) => {
      if (sql.includes('create table if not exists ops_tasks')) {
        throw new Error('relation "ops_tasks" already exists');
      }
      return { rows: [] };
    },
  });
  await assert.doesNotReject(() => ensureOpsTasksTable(pool));
});

test('ensureOpsTasksTable: swallows unique-violation (23505) when table already present', async () => {
  const pool = makePool({
    onQuery: (sql) => {
      if (sql.includes('create table if not exists ops_tasks')) {
        const e = new Error('duplicate key value violates unique constraint');
        e.code = '23505';
        throw e;
      }
      if (sql.includes("to_regclass('public.ops_tasks')")) {
        return { rows: [{ rel: 'ops_tasks' }] };
      }
      return { rows: [] };
    },
  });
  await assert.doesNotReject(() => ensureOpsTasksTable(pool));
});

test('ensureOpsTasksTable: rethrows unrecognized DB errors', async () => {
  const pool = makePool({
    onQuery: (sql) => {
      if (sql.includes('create table if not exists ops_tasks')) {
        throw new Error('connection terminated unexpectedly');
      }
      return { rows: [] };
    },
  });
  await assert.rejects(() => ensureOpsTasksTable(pool), /connection terminated/);
});
