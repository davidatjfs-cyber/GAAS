import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFeishuSignature, verifyFeishuWebhookRequest } from './feishu-webhook-verify.js';

test('computeFeishuSignature matches sha256 of timestamp+nonce+key+body', () => {
  const rawBody = Buffer.from('{"hello":1}', 'utf8');
  const sig = computeFeishuSignature({
    timestamp: '123',
    nonce: 'abc',
    encryptKey: 'key',
    rawBody,
  });
  assert.equal(sig.length, 64);
  const again = computeFeishuSignature({ timestamp: '123', nonce: 'abc', encryptKey: 'key', rawBody });
  assert.equal(sig, again);
});

test('verifyFeishuWebhookRequest accepts valid signature', () => {
  const rawBody = Buffer.from('{"type":"event"}', 'utf8');
  const signature = computeFeishuSignature({
    timestamp: '1',
    nonce: 'n',
    encryptKey: 'ek',
    rawBody,
  });
  const r = verifyFeishuWebhookRequest({
    headers: {
      'x-lark-request-timestamp': '1',
      'x-lark-request-nonce': 'n',
      'x-lark-signature': signature,
    },
    rawBody,
    parsedBody: { type: 'event' },
    encryptKey: 'ek',
    requireSignature: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'signature');
});

test('verifyFeishuWebhookRequest rejects bad signature when required', () => {
  const rawBody = Buffer.from('{"type":"event"}', 'utf8');
  const r = verifyFeishuWebhookRequest({
    headers: {
      'x-lark-request-timestamp': '1',
      'x-lark-request-nonce': 'n',
      'x-lark-signature': 'deadbeef',
    },
    rawBody,
    parsedBody: { type: 'event' },
    encryptKey: 'ek',
    requireSignature: true,
  });
  assert.equal(r.ok, false);
});

test('verifyFeishuWebhookRequest skips when not required', () => {
  const r = verifyFeishuWebhookRequest({
    headers: {},
    rawBody: Buffer.from('{}'),
    parsedBody: {},
    encryptKey: '',
    requireSignature: false,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'skipped');
});
