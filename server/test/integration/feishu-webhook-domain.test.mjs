/**
 * Wave 4q：Feishu webhook 域拆分验收集成测（对当前 index.js 已注册路由）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/boot-app.mjs';
import { ensureDefaultTenant } from './helpers/db.mjs';

let app;

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('POST /api/webhook/feishu：测试环境 isWebhookEnabled 关 → 404 Not found', async () => {
  const res = await fetch(app.baseUrl + '/api/webhook/feishu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ping' }),
  });
  const text = await res.text();
  assert.equal(res.status, 404, text);
  assert.equal(text, 'Not found');
  assert.ok(!text.includes('Cannot POST'), '不应是 Express 默认 404 页');
});
