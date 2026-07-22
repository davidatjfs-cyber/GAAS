import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFeishuSignature,
  verifyFeishuWebhookRequest,
  fetchFeishuTenantAccessToken,
  SHARED_TABLES,
  SHARED_TABLE_WRITERS,
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

test('shared: table writer matrix covers master_tasks / hrms_state', () => {
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.MASTER_TASKS], 'agents');
  assert.equal(SHARED_TABLE_WRITERS[SHARED_TABLES.HRMS_STATE], 'gaas');
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
