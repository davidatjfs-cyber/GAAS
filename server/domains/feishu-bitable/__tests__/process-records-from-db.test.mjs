import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessBitableRecordsFromDB } from '../process-records-from-db.js';

function makeProcessor(overrides = {}) {
  const calls = { process: [], extract: [], confirm: [], logs: [] };
  const processedRecordIds = new Set();
  const lastProcessedTime = new Map();
  const rows = overrides.rows ?? [
    {
      record_id: 'r1',
      fields: { 所属门店: '洪潮店', 提交人: '甲' },
      raw: {},
      created_at: new Date('2026-07-26T12:00:00Z'),
      updated_at: new Date('2026-07-26T12:00:00Z'),
    },
  ];
  const process = createProcessBitableRecordsFromDB({
    pool: () => ({
      query: async () => ({ rows }),
    }),
    bitableConfigs: {
      ops_checklist: { tableId: 'tbl_ops' },
      empty: { tableId: '' },
    },
    processedRecordIds,
    lastProcessedTime,
    dedupMaxKeys: 10,
    dedupCleanCount: 2,
    extractRelationsFromBitableRecord: async (...a) => { calls.extract.push(a); },
    processBitableData: async (...a) => { calls.process.push(a); },
    processChecklistConfirmation: async (sub) => { calls.confirm.push(sub); },
    log: {
      info: (...a) => calls.logs.push(['info', ...a]),
      error: (...a) => calls.logs.push(['error', ...a]),
      warn: (...a) => calls.logs.push(['warn', ...a]),
    },
    ...overrides,
  });
  return { process, calls, processedRecordIds, lastProcessedTime };
}

test('missing tableId returns early', async () => {
  const { process, calls } = makeProcessor();
  await process('empty');
  assert.equal(calls.process.length, 0);
});

test('query failure logs and returns', async () => {
  const { process, calls } = makeProcessor({
    pool: () => ({
      query: async () => { throw new Error('db down'); },
    }),
  });
  await process('ops_checklist');
  assert.equal(calls.process.length, 0);
  assert.ok(calls.logs.some((l) => l[0] === 'error' && String(l[1]).includes('query')));
});

test('empty rows returns without process', async () => {
  const { process, calls } = makeProcessor({ rows: [] });
  await process('ops_checklist');
  assert.equal(calls.process.length, 0);
});

test('processes new records and confirms ops_checklist', async () => {
  const { process, calls, processedRecordIds, lastProcessedTime } = makeProcessor();
  await process('ops_checklist');
  assert.equal(calls.extract.length, 1);
  assert.equal(calls.process.length, 1);
  assert.equal(calls.confirm.length, 1);
  assert.equal(calls.confirm[0].store, '洪潮店');
  assert.ok(processedRecordIds.has('ops_checklist_r1'));
  assert.ok(lastProcessedTime.get('ops_checklist_r1') > 0);
});

test('skips already-seen watermark and ignores confirm when not a function', async () => {
  const updated = new Date('2026-07-26T12:00:00Z');
  const { process, calls, lastProcessedTime } = makeProcessor({
    processChecklistConfirmation: undefined,
    rows: [
      {
        record_id: 'r1',
        fields: {},
        raw: {},
        created_at: updated,
        updated_at: updated,
      },
    ],
  });
  lastProcessedTime.set('ops_checklist_r1', updated.getTime());
  await process('ops_checklist');
  assert.equal(calls.process.length, 0);
  assert.equal(calls.confirm.length, 0);
});

test('confirmation errors are logged and do not abort', async () => {
  const { process, calls } = makeProcessor({
    processChecklistConfirmation: async () => { throw new Error('boom'); },
  });
  await process('ops_checklist');
  assert.equal(calls.process.length, 1);
  assert.ok(calls.logs.some((l) => String(l[1] || '').includes('confirmation error')));
});
