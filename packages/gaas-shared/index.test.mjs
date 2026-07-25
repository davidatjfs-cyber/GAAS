import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFeishuSignature,
  verifyFeishuWebhookRequest,
  fetchFeishuTenantAccessToken,
  SHARED_TABLES,
  SHARED_TABLE_WRITERS,
  HR_RATING_CONFIG_KEYS,
} from './index.js';

test('shared: signature roundtrip', () => {
  const rawBody = Buffer.from('{"type":"event_callback"}');
  const sig = computeFeishuSignature({
    timestamp: '1',
    nonce: 'n',
    encryptKey: 'k',
    rawBody,
  });
  const r = verifyFeishuWebhookRequest({
    headers: {
      'x-lark-request-timestamp': '1',
      'x-lark-request-nonce': 'n',
      'x-lark-signature': sig,
    },
    rawBody,
    encryptKey: 'k',
    requireSignature: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'signature');
});

test('shared: table writer matrix covers master_tasks / hrms_state / employees', () => {
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.MASTER_TASKS], 'agents');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.HRMS_STATE], 'gaas');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.EMPLOYEES], 'gaas');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.HR_RATING_CONFIGS], 'gaas');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.EXAM_RESULTS], 'gaas');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.HRMS_USER_NOTIFICATIONS], 'gaas');
  assert.equal(HR_RATING_CONFIG_KEYS.APPROVAL_FLOWS, 'approval_flows');
});

test('shared: SHARED_TABLE_WRITERS 全表覆盖且写入方仅 gaas|agents', () => {
  const allowed = new Set(['gaas', 'agents']);
  const tables = Object.values(SHARED_TABLES);
  assert.ok(tables.length >= 15);
  for (const table of tables) {
    assert.ok(Object.prototype.hasOwnProperty.call(SHARED_TABLE_WRITERS, table), table);
    assert.ok(allowed.has(SHARED_TABLE_WRITERS[table]), `${table}=${SHARED_TABLE_WRITERS[table]}`);
  }
  for (const table of Object.keys(SHARED_TABLE_WRITERS)) {
    assert.ok(tables.includes(table), `unknown ${table}`);
  }
});

test('shared: fetchFeishuTenantAccessToken uses fetchImpl', async () => {
  const token = await fetchFeishuTenantAccessToken({
    appId: 'id',
    appSecret: 'sec',
    fetchImpl: async () => ({
      json: async () => ({ code: 0, tenant_access_token: 't-demo', expire: 7200 }),
    }),
  });
  assert.equal(token.token, 't-demo');
});
