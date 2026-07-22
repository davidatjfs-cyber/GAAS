import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/boot-app.mjs';
import { computeFeishuSignature } from '../../utils/feishu-webhook-verify.js';

// P1覆盖：飞书webhook是唯一一个无需认证(公网可访问)的入口，签名校验是它唯一的
// 防线。utils/feishu-webhook-verify.js 已经有函数级单元测试，这里补的是"整条
// 路由真的按预期强制校验"的集成测试——防止以后有人改了路由注册顺序/中间件，
// 让签名校验被绕过了都没人发现。

const ENCRYPT_KEY = 'test-encrypt-key-for-integration-test';

let app;

test.before(async () => {
  app = await bootApp({
    ENABLE_WEBHOOK: 'true',
    REQUIRE_WEBHOOK_SIGNATURE: 'true',
    FEISHU_ENCRYPT_KEY: ENCRYPT_KEY
  });
});

test.after(async () => {
  await app.stop();
});

test('签名正确的webhook请求应该被接受', async () => {
  const body = { header: { event_type: 'im.message.receive_v1' }, event: {} };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'test-nonce-1';
  const signature = computeFeishuSignature({ timestamp, nonce, encryptKey: ENCRYPT_KEY, rawBody });

  const res = await fetch(app.baseUrl + '/api/feishu/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lark-Request-Timestamp': timestamp,
      'X-Lark-Request-Nonce': nonce,
      'X-Lark-Signature': signature
    },
    body: rawBody
  });
  assert.notEqual(res.status, 401, '签名正确不应该被拒绝');
});

test('签名错误的webhook请求应该被拒绝(401)，不会进入业务逻辑', async () => {
  const body = { header: { event_type: 'im.message.receive_v1' }, event: {} };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'test-nonce-2';

  const res = await fetch(app.baseUrl + '/api/feishu/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lark-Request-Timestamp': timestamp,
      'X-Lark-Request-Nonce': nonce,
      'X-Lark-Signature': 'deliberately-wrong-signature'
    },
    body: rawBody
  });
  assert.equal(res.status, 401, '签名错误应该被拒绝');
});

test('缺少签名头的webhook请求，在强制签名模式下应该被拒绝', async () => {
  const body = { header: { event_type: 'im.message.receive_v1' }, event: {} };

  const res = await fetch(app.baseUrl + '/api/feishu/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal(res.status, 401, '强制签名模式下，完全没带签名头应该被拒绝');
});
