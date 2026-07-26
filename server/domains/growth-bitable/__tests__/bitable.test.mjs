/**
 * growth-bitable helpers + reader tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bitText, bitNum, bitDateMs, bitPhone } from '../helpers.js';
import { createStoredValueBitableReader } from '../read-stored-value.js';

test('bitText / bitNum / bitDateMs / bitPhone', () => {
  assert.equal(bitText(null), '');
  assert.equal(bitText([{ text: 'a' }, { name: 'b' }]), 'a,b');
  assert.equal(bitText({ text: 'x' }), 'x');
  assert.equal(bitText(12), '12');

  assert.equal(bitNum(null), 0);
  assert.equal(bitNum({ text: '3.5' }), 3.5);
  assert.equal(bitNum('nope'), 0);

  assert.equal(bitDateMs(null), 0);
  assert.equal(bitDateMs(1_700_000_000_000), 1_700_000_000_000);
  assert.ok(bitDateMs('2026-07-27T00:00:00.000Z') > 0);
  assert.equal(bitDateMs('not-a-date'), 0);

  assert.equal(bitPhone('138-0000-0000'), '13800000000');
});

test('createStoredValueBitableReader paginates', async () => {
  const calls = [];
  const read = createStoredValueBitableReader({
    env: {
      BITABLE_TASK_RESP_APP_ID: 'id',
      BITABLE_TASK_RESP_APP_SECRET: 'sec',
      STORED_VALUE_BITABLE_APP_TOKEN: 'app',
      STORED_VALUE_BITABLE_TABLE_ID: 'tbl',
    },
    fetchFn: async (url, init) => {
      calls.push({ url: String(url), method: init?.method || 'GET' });
      if (String(url).includes('tenant_access_token')) {
        return { json: async () => ({ tenant_access_token: 'tok' }) };
      }
      if (String(url).includes('page_token=')) {
        return {
          json: async () => ({
            code: 0,
            data: { items: [{ record_id: 'r2' }], has_more: false },
          }),
        };
      }
      return {
        json: async () => ({
          code: 0,
          data: { items: [{ record_id: 'r1' }], has_more: true, page_token: 'p2' },
        }),
      };
    },
  });
  const rows = await read();
  assert.deepEqual(rows.map((r) => r.record_id), ['r1', 'r2']);
  assert.equal(calls.length, 3);
});

test('createStoredValueBitableReader errors', async () => {
  await assert.rejects(
    createStoredValueBitableReader({ env: {}, fetchFn: async () => ({}) })(),
    /bitable_app_not_configured/
  );
  await assert.rejects(
    createStoredValueBitableReader({
      env: { BITABLE_TASK_RESP_APP_ID: 'a', BITABLE_TASK_RESP_APP_SECRET: 'b' },
      fetchFn: async () => ({ json: async () => ({ code: 1, msg: 'no' }) }),
    })(),
    /bitable_token_failed/
  );
});
