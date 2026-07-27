import test from 'node:test';
import assert from 'node:assert/strict';
import { listAbAudienceForSendDate, queueAbSmsAssignments } from '../ab-audience-service.js';

test('listAbAudienceForSendDate: returns [] without querying when store/date missing', async () => {
  let called = false;
  const pool = { async query() { called = true; return { rows: [] }; } };
  assert.deepEqual(await listAbAudienceForSendDate(pool, '', '2026-07-01'), []);
  assert.deepEqual(await listAbAudienceForSendDate(pool, '51866138', 'not-a-date'), []);
  assert.equal(called, false);
});

test('listAbAudienceForSendDate: computes lookback start date and returns rows', async () => {
  let params;
  const pool = {
    async query(_sql, values) {
      params = values;
      return { rows: [{ customer_id: 1, phone: '13800000000' }] };
    },
  };
  const rows = await listAbAudienceForSendDate(pool, '51866138', '2026-07-10', 5);
  assert.deepEqual(rows, [{ customer_id: 1, phone: '13800000000' }]);
  assert.deepEqual(params, ['51866138', '2026-07-10', '2026-07-05']);
});

test('queueAbSmsAssignments: no-op on empty audience', async () => {
  let called = false;
  const pool = { async query() { called = true; return { rows: [] }; } };
  const result = await queueAbSmsAssignments(pool, { id: 1 }, []);
  assert.deepEqual(result, { created: 0, audience: 0 });
  assert.equal(called, false);
});

test('queueAbSmsAssignments: skips rows without customer_id/phone, inserts valid ones', async () => {
  const inserted = [];
  const pool = {
    async query(_sql, values) {
      inserted.push(values);
      return { rows: [{ id: inserted.length }] };
    },
  };
  const taskRow = {
    id: 42,
    store_code: '51866138',
    test_name: 'sms-test',
    target_metric: 'redemption_rate',
    start_date: '2026-07-10',
    variant_a: { content: '您好{姓名}，A组' },
    variant_b: { content: '您好{姓名}，B组' },
  };
  const audienceRows = [
    { customer_id: 0, phone: '13800000000', customer_name: '无效' },
    { customer_id: 1, phone: '', customer_name: '无手机号' },
    { customer_id: 2, phone: '13900000000', customer_name: '张三' },
  ];
  const result = await queueAbSmsAssignments(pool, taskRow, audienceRows, {}, 'tenant-a');
  assert.equal(result.created, 1);
  assert.equal(result.audience, 3);
  assert.equal(inserted.length, 1);
  const payload = JSON.parse(inserted[0][6]);
  assert.equal(payload.ab_test_id, 42);
  assert.equal(payload.phone, '13900000000');
  assert.match(payload.sms_copy, /张三/);
  assert.equal(inserted[0][9], 'tenant-a');
});
