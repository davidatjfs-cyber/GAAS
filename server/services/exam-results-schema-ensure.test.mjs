import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureExamResultsTable } from './exam-results-schema-ensure.js';

function makePool({ onQuery } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (onQuery) return onQuery(String(sql), params);
      if (String(sql).includes('information_schema.columns')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    },
  };
}

test('ensureExamResultsTable: happy path creates table, backfills columns, adds indexes when columns present', async () => {
  const pool = makePool();
  await ensureExamResultsTable(pool);
  const sqls = pool.calls.map((c) => c.sql);
  assert.ok(sqls.some((s) => s.includes('create table if not exists exam_results')));
  assert.ok(sqls.some((s) => s.includes('add column if not exists assignment_id')));
  assert.ok(sqls.some((s) => s.includes('idx_exam_results_user_key_created_at')));
  assert.ok(sqls.some((s) => s.includes('idx_exam_results_assignment_id')));
});

test('ensureExamResultsTable: skips indexes when required columns are missing', async () => {
  const pool = makePool({
    onQuery: (sql) => {
      if (sql.includes('information_schema.columns')) return { rows: [] };
      return { rows: [] };
    },
  });
  await ensureExamResultsTable(pool);
  const sqls = pool.calls.map((c) => c.sql);
  assert.ok(!sqls.some((s) => s.includes('idx_exam_results_user_key_created_at')));
  assert.ok(!sqls.some((s) => s.includes('idx_exam_results_assignment_id')));
});

test('ensureExamResultsTable: swallows DB errors (logs, does not throw)', async () => {
  const pool = makePool({
    onQuery: (sql) => {
      if (sql.includes('create table if not exists exam_results')) {
        throw new Error('db_unreachable');
      }
      return { rows: [] };
    },
  });
  await assert.doesNotReject(() => ensureExamResultsTable(pool));
});
