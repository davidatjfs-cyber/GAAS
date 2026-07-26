import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bitableRowUpdatedAtMs,
  buildBitableCapacityMessages,
  buildDbBitableSubmission,
  collectNewDbBitableSubmissions,
  computeListenReconnectDelay,
  listCatchupConfigKeys,
  mapFeishuGenericRowsToRecords,
  markBitableRecordsProcessed,
  msUntilNextArchiveAt3am,
  nextListenBackoffMs,
  parseJsonObject,
  pickAggressiveCatchupDelay,
  resolveBitableConfigKeyFromNotifyPayload,
  shouldTriggerAggressiveCatchup,
} from '../listen-helpers.js';

const CONFIGS = {
  ops_checklist: { tableId: 'tbl_ops', type: 'checklist' },
  bad_reviews: { tableId: 'tbl_bad', type: 'bad_review' },
  task_responses: { tableId: 'tbl_task', type: 'task_response' },
  empty: { tableId: '', type: 'x' },
};

test('resolveBitableConfigKeyFromNotifyPayload by key and tableId', () => {
  assert.equal(resolveBitableConfigKeyFromNotifyPayload('', CONFIGS), null);
  assert.equal(resolveBitableConfigKeyFromNotifyPayload('ops_checklist', CONFIGS), 'ops_checklist');
  assert.equal(resolveBitableConfigKeyFromNotifyPayload('tbl_bad', CONFIGS), 'bad_reviews');
  assert.equal(resolveBitableConfigKeyFromNotifyPayload('tbl_task', CONFIGS), null);
  assert.equal(resolveBitableConfigKeyFromNotifyPayload('unknown', CONFIGS), null);
});

test('bitableRowUpdatedAtMs prefers updated_at', () => {
  assert.equal(bitableRowUpdatedAtMs({}), 0);
  assert.equal(bitableRowUpdatedAtMs({ updated_at: 'not-a-date' }), 0);
  const ms = Date.parse('2026-07-01T00:00:00.000Z');
  assert.equal(bitableRowUpdatedAtMs({ updated_at: '2026-07-01T00:00:00.000Z' }), ms);
  assert.equal(bitableRowUpdatedAtMs({ created_at: new Date(ms) }), ms);
  assert.equal(bitableRowUpdatedAtMs({ created_time: ms }), ms);
});

test('parseJsonObject / mapFeishuGenericRowsToRecords', () => {
  assert.deepEqual(parseJsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonObject({ b: 2 }), { b: 2 });
  assert.deepEqual(parseJsonObject('not-json'), {});
  assert.deepEqual(parseJsonObject(null), {});

  const records = mapFeishuGenericRowsToRecords([
    {
      record_id: 'r1',
      fields: '{"门店":"洪潮"}',
      raw: '{"created_time":9}',
      created_at: 'c',
      updated_at: 'u',
    },
  ]);
  assert.equal(records[0].record_id, 'r1');
  assert.equal(records[0].fields['门店'], '洪潮');
  assert.equal(records[0].created_time, 9);
  assert.equal(records[0].created_at, 'c');
});

test('buildDbBitableSubmission maps fields', () => {
  const sub = buildDbBitableSubmission('ops_checklist', {
    record_id: 'r1',
    created_at: 100,
    fields: {
      提交人: '甲',
      所属门店: '洪潮店',
      检查类型: '开市',
      检查状态: '正常',
      检查说明: 'ok',
      检查照片: [1],
      提交日期: 200,
    },
  });
  assert.equal(sub.recordId, 'r1');
  assert.equal(sub.store, '洪潮店');
  assert.equal(sub.submitTime, 200);
  assert.equal(sub.checkType, '开市');
});

test('collectNewDbBitableSubmissions skips watermarked rows', () => {
  const last = new Map([['cfg_r_old', 1000]]);
  const { newSubmissions, newRecords } = collectNewDbBitableSubmissions(
    [
      { record_id: 'r_old', updated_at: 500, fields: { 门店: 'A' } },
      { record_id: 'r_new', updated_at: 2000, fields: { 门店: 'B' } },
      { record_id: 'r_fresh', fields: {} },
    ],
    'cfg',
    last
  );
  assert.equal(newRecords.length, 2);
  assert.equal(newSubmissions[0].recordId, 'r_new');
  assert.equal(newSubmissions[1].recordId, 'r_fresh');
});

test('markBitableRecordsProcessed updates dedup and cleans', () => {
  const ids = new Set(['a_1', 'a_2']);
  const last = new Map([
    ['a_1', 1],
    ['a_2', 2],
  ]);
  markBitableRecordsProcessed(
    [{ record_id: '3', updated_at: 3000 }],
    'a',
    ids,
    last,
    2,
    1
  );
  assert.ok(ids.has('a_3'));
  assert.equal(last.get('a_3'), 3000);
  assert.ok(ids.size <= 2);
});

test('listCatchupConfigKeys skips task_response and empty tableId', () => {
  assert.deepEqual(listCatchupConfigKeys(CONFIGS).sort(), ['bad_reviews', 'ops_checklist']);
});

test('reconnect / backoff / aggressive catchup helpers', () => {
  assert.equal(computeListenReconnectDelay(1000, 2000, 90000), 2000);
  assert.equal(computeListenReconnectDelay(50000, 2000, 90000), 50000);
  assert.equal(nextListenBackoffMs(2000, 90000), 4000);
  assert.equal(nextListenBackoffMs(80000, 90000), 90000);
  assert.equal(shouldTriggerAggressiveCatchup(2, 3), false);
  assert.equal(shouldTriggerAggressiveCatchup(3, 3), true);
  assert.equal(pickAggressiveCatchupDelay(28000, () => 0), 1500);
  assert.equal(pickAggressiveCatchupDelay(1000, () => 0.9), 800);
});

test('buildBitableCapacityMessages thresholds', () => {
  assert.equal(buildBitableCapacityMessages({ main: { total: 10 }, total: 10 }).warning, null);
  const warn = buildBitableCapacityMessages({ main: { total: 1001 }, total: 1200 });
  assert.match(warn.warning, /容量提醒/);
  assert.equal(warn.critical, null);
  const crit = buildBitableCapacityMessages({ main: { total: 1600 }, total: 1800 });
  assert.match(crit.critical, /容量预警/);
});

test('msUntilNextArchiveAt3am returns future 03:00', () => {
  const now = new Date('2026-07-26T10:00:00');
  const { msUntilArchive, nextAt } = msUntilNextArchiveAt3am(now);
  assert.ok(msUntilArchive > 0);
  assert.equal(nextAt.getHours(), 3);
  assert.equal(nextAt.getDate(), 27);
});
