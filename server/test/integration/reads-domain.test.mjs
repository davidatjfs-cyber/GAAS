/**
 * Wave 4m：reads/batch + unread-counts 集成测。
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

test('POST /api/reads/batch：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/reads/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'approval', keys: ['x'] }),
  });
  assert.equal(res.status, 401);
});

test('GET /api/unread-counts：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/unread-counts');
  assert.equal(res.status, 401);
});

test('POST /api/reads/batch：缺 module → 400', async () => {
  const u = uniqueId('rd_mod');
  await createUser(u, 'store_employee');
  const token = await login(u);
  const res = await fetch(app.baseUrl + '/api/reads/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ keys: ['a'] }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_module');
});

test('POST /api/reads/batch：空 keys → 200 inserted 0', async () => {
  const u = uniqueId('rd_empty');
  await createUser(u, 'store_employee');
  const token = await login(u);
  const res = await fetch(app.baseUrl + '/api/reads/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ module: 'approval', keys: [] }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.inserted, 0);
});

test('GET /api/unread-counts：登录 → 200 含七字段', async () => {
  const u = uniqueId('rd_cnt');
  await createUser(u, 'hq_manager');
  const token = await login(u);
  const res = await fetch(app.baseUrl + '/api/unread-counts', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  for (const k of ['approvals', 'training', 'exam', 'dashboard', 'rewards', 'payment', 'opsTasks']) {
    assert.equal(typeof body[k], 'number', k + '=' + body[k]);
  }
});
