import test from 'node:test';
import assert from 'node:assert/strict';
import { createBitableDedupPollApi } from '../bitable-dedup-poll.js';

test('seedBitableDedup maps table_id to config keys and is idempotent', async () => {
  const logs = [];
  const api = createBitableDedupPollApi({
    pool: () => ({
      query: async () => ({
        rows: [
          { record_id: 'r1', table_id: 'tblA', updated_at: '2026-01-01T00:00:00Z' },
          { record_id: '', table_id: 'tblA', updated_at: null },
        ],
      }),
    }),
    bitableConfigs: {
      ops_checklist: { tableId: 'tblA' },
      task_response: { tableId: 'tblX', type: 'task_response' },
      other: { tableId: 'tblB' },
    },
    pollBitableSubmissions: async () => {},
    log: { info: (m) => logs.push(m), error: () => {} },
  });
  await api.seedBitableDedup();
  await api.seedBitableDedup();
  assert.ok(api.processedRecordIds.has('ops_checklist_r1'));
  assert.equal(api.lastProcessedTime.get('ops_checklist_r1'), Date.parse('2026-01-01T00:00:00Z'));
  assert.ok(logs.some((m) => /seeded dedup/.test(m)));
});

test('seedBitableDedup falls back when table_id unknown; logs on query failure', async () => {
  const errs = [];
  const api = createBitableDedupPollApi({
    pool: () => ({
      query: async () => ({ rows: [{ record_id: 'r2', table_id: 'unknown', updated_at: 'bad' }] }),
    }),
    bitableConfigs: {
      ops_checklist: { tableId: 'tblA' },
      task_response: { type: 'task_response' },
    },
    pollBitableSubmissions: async () => {},
    log: { info: () => {}, error: (m) => errs.push(m) },
  });
  await api.seedBitableDedup();
  assert.ok(api.processedRecordIds.has('ops_checklist_r2'));
  assert.equal(api.lastProcessedTime.get('ops_checklist_r2'), 0);

  const fail = createBitableDedupPollApi({
    pool: () => ({ query: async () => { throw new Error('db'); } }),
    bitableConfigs: {},
    pollBitableSubmissions: async () => {},
    log: { info: () => {}, error: (m) => errs.push(m) },
  });
  await fail.seedBitableDedup();
  assert.ok(errs.some((m) => /seed dedup failed/.test(m)));
});

test('pollAllBitableSubmissions walks preferred then remaining and continues on error', async () => {
  const seen = [];
  const api = createBitableDedupPollApi({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    bitableConfigs: {
      table_visit: {},
      ops_checklist: {},
      custom_x: {},
      task_response: { type: 'task_response' },
    },
    pollBitableSubmissions: async (key) => {
      seen.push(key);
      if (key === 'ops_checklist') throw new Error('boom');
    },
    log: { info: () => {}, error: () => {} },
  });
  await api.pollAllBitableSubmissions();
  assert.deepEqual(seen[0], 'ops_checklist');
  assert.ok(seen.includes('table_visit'));
  assert.ok(seen.includes('custom_x'));
  assert.ok(!seen.includes('task_response'));
});
