/**
 * Wave 4p：dedup 域拆分验收集成测。
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

test('GET /api/dedup/stats：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/dedup/stats');
  assert.equal(res.status, 401);
});

test('GET /api/dedup/stats：store_employee → 403 admin_only', async () => {
  const username = uniqueId('dedup_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/dedup/stats', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'admin_only');
});

test('GET /api/dedup/stats：admin → 200 + tables', async () => {
  const username = uniqueId('dedup_admin');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/dedup/stats', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.ok(body.tables && typeof body.tables === 'object', JSON.stringify(body).slice(0, 300));
});
