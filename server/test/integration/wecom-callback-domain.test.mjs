/**
 * Wave 4o：wecom callback 域拆分验收集成测。
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

test('GET /api/wecom/callback：无 query → 200 body ok', async () => {
  const res = await fetch(app.baseUrl + '/api/wecom/callback');
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(text, 'ok');
});

test('GET /api/wecom/callback：echostr=plain123（无明文加密 env）→ 200 plain123', async () => {
  const url = app.baseUrl + '/api/wecom/callback?' + new URLSearchParams({ echostr: 'plain123' });
  const res = await fetch(url);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(text, 'plain123');
});

test('POST /api/wecom/callback → 200', async () => {
  const res = await fetch(app.baseUrl + '/api/wecom/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ foo: 'bar' }),
  });
  assert.equal(res.status, 200);
});
