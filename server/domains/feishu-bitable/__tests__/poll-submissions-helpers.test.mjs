import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRANSIENT_BITABLE_ERRORS,
  fetchAllBitableRecords,
  collectNewBitableSubmissions,
  persistGenericBitableRecords,
} from '../poll-submissions-helpers.js';

function makeRecord(id, fields = {}, createdTime = 1000) {
  return { record_id: id, created_time: createdTime, fields };
}

test('TRANSIENT_BITABLE_ERRORS 含常见 transient code', () => {
  assert.ok(TRANSIENT_BITABLE_ERRORS.has('1254607'));
  assert.ok(TRANSIENT_BITABLE_ERRORS.has('ETIMEDOUT'));
  assert.ok(TRANSIENT_BITABLE_ERRORS.has('timeout of 10000ms exceeded'));
});

test('fetchAllBitableRecords: 分页合并 records', async () => {
  const calls = [];
  const records = await fetchAllBitableRecords(
    'ops_checklist',
    async (_key, { pageToken }) => {
      calls.push(pageToken);
      if (!pageToken) {
        return { ok: true, records: [makeRecord('r1')], hasMore: true, nextPageToken: 'p2' };
      }
      return { ok: true, records: [makeRecord('r2')], hasMore: false, nextPageToken: '' };
    },
    { info: () => {}, error: () => {} }
  );

  assert.deepEqual(records.map((r) => r.record_id), ['r1', 'r2']);
  assert.deepEqual(calls, ['', 'p2']);
});

test('fetchAllBitableRecords: transient 错误返回 null 且 info 日志', async () => {
  const logs = [];
  const log = {
    info: (p) => logs.push(['info', p]),
    error: (p) => logs.push(['error', p]),
  };
  const out = await fetchAllBitableRecords(
    'cfg1',
    async () => ({ ok: false, error: '1254607_data_not_ready' }),
    log
  );
  assert.equal(out, null);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'info');
  assert.match(String(logs[0][1].detail), /transient error/);
});

test('fetchAllBitableRecords: 永久错误 error 日志', async () => {
  const logs = [];
  const out = await fetchAllBitableRecords(
    'cfg1',
    async () => ({ ok: false, error: 'permission_denied' }),
    { info: () => {}, error: (p) => logs.push(p) }
  );
  assert.equal(out, null);
  assert.equal(logs.length, 1);
  assert.match(String(logs[0].detail), /poll failed/);
});

test('collectNewBitableSubmissions: 映射字段并跳过已处理', () => {
  const processedRecordIds = new Set(['cfg1_r_old']);
  const lastProcessedTime = new Map();
  const logs = [];

  const { newSubmissions, newRecords } = collectNewBitableSubmissions(
    [
      makeRecord('r_old', { 提交人: '甲' }),
      makeRecord('r_new', {
        提交人: '乙',
        所属门店: '洪潮店',
        检查类型: '开市',
        检查状态: '正常',
        检查说明: '一切正常',
        检查照片: [{ file_token: 'f1' }],
        提交日期: 2000,
      }, 2000),
    ],
    'cfg1',
    processedRecordIds,
    lastProcessedTime,
    100,
    10,
    { info: (p) => logs.push(p) }
  );

  assert.equal(newSubmissions.length, 1);
  assert.equal(newRecords.length, 1);
  assert.equal(newSubmissions[0].recordId, 'r_new');
  assert.equal(newSubmissions[0].store, '洪潮店');
  assert.equal(newSubmissions[0].checkType, '开市');
  assert.equal(newSubmissions[0].submitTime, 2000);
  assert.ok(processedRecordIds.has('cfg1_r_new'));
  assert.equal(lastProcessedTime.get('cfg1_r_new'), 2000);
  assert.ok(logs.some((p) => String(p.detail).includes('new submission')));
});

test('collectNewBitableSubmissions: 超过 dedupMaxKeys 时清理最旧项', () => {
  const processedRecordIds = new Set(['a_1', 'a_2', 'a_3']);
  const lastProcessedTime = new Map([
    ['a_1', 1],
    ['a_2', 2],
    ['a_3', 3],
  ]);

  collectNewBitableSubmissions(
    [makeRecord('4', {}, 4)],
    'a',
    processedRecordIds,
    lastProcessedTime,
    3,
    2,
    { info: () => {} }
  );

  assert.equal(processedRecordIds.size, 2);
  assert.ok(!processedRecordIds.has('a_1'));
  assert.ok(!processedRecordIds.has('a_2'));
  assert.ok(processedRecordIds.has('a_3'));
  assert.ok(processedRecordIds.has('a_4'));
});

test('persistGenericBitableRecords: upsert 参数正确', async () => {
  const queries = [];
  const pool = () => ({
    query: async (sql, params) => {
      queries.push({ sql: String(sql), params });
      return { rows: [] };
    },
  });

  await persistGenericBitableRecords(
    pool,
    'ops_checklist',
    [makeRecord('rec_x', { 门店: '测试' })],
    { ops_checklist: { appToken: 'app1', tableId: 'tbl1' } },
    { error: () => {} }
  );

  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO feishu_generic_records/);
  assert.equal(queries[0].params[0], 'app1');
  assert.equal(queries[0].params[1], 'tbl1');
  assert.equal(queries[0].params[2], 'rec_x');
});

test('persistGenericBitableRecords: duplicate 错误静默；其他错误记日志', async () => {
  const logs = [];
  const poolDup = () => ({
    query: async () => {
      throw new Error('duplicate key value violates unique constraint');
    },
  });
  await persistGenericBitableRecords(
    poolDup,
    'ops_checklist',
    [makeRecord('rec_y', {})],
    { ops_checklist: { appToken: 'app1', tableId: 'tbl1' } },
    { error: (p) => logs.push(p) }
  );
  assert.equal(logs.length, 0);

  const poolErr = () => ({
    query: async () => {
      throw new Error('connection refused');
    },
  });
  await persistGenericBitableRecords(
    poolErr,
    'ops_checklist',
    [makeRecord('rec_z', {})],
    { ops_checklist: { appToken: 'app1', tableId: 'tbl1' } },
    { error: (p) => logs.push(p) }
  );
  assert.equal(logs.length, 1);
  assert.match(String(logs[0].detail), /save generic record failed/);
});
