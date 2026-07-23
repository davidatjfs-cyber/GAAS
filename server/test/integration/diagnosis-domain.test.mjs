/**
 * Wave 4q：diagnosis 反馈/统计域拆分验收集成测（对当前 index.js 已注册路由）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

let app;

async function createUser(username, role, tenantId = 'default') {
  const db = testDb();
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', $3, true, $4)
     on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role, is_active = true`,
    [username, hash, role, tenantId]
  );
}

async function login(username) {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Pass12345' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.token;
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('POST /api/agent/diagnosis-feedback：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/agent/diagnosis-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: 't1', feedback: 1 }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/agent/diagnosis-feedback：缺 task_id → 400', async () => {
  const username = uniqueId('dg_fb_u');
  await createUser(username, 'store_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/agent/diagnosis-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ feedback: 1 }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing task_id or feedback');
});

test('POST /api/agent/diagnosis-feedback：feedback=2 → 400', async () => {
  const username = uniqueId('dg_fb_bad');
  await createUser(username, 'store_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/agent/diagnosis-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ task_id: 't1', feedback: 2 }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'feedback must be 0 or 1');
});

test('GET /api/admin/diagnosis-stats：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/diagnosis-stats');
  assert.equal(res.status, 401);
});

test('GET /api/admin/diagnosis-stats：store_employee → 403', async () => {
  const username = uniqueId('dg_st_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/diagnosis-stats', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});
