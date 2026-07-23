/**
 * Wave 4h：permission-groups 域拆分验收集成测（对当前 index.js 已注册路由）。
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

async function createAdmin() {
  const username = uniqueId('pg_admin');
  await createUser(username, 'admin');
  return username;
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

test('GET /api/permission-groups：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/permission-groups');
  assert.equal(res.status, 401);
});

test('PUT /api/permission-groups：store_employee → 403 admin_only', async () => {
  const username = uniqueId('pg_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/permission-groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ groups: [] }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'admin_only');
});

test('PUT /api/permission-groups：admin invalid_groups → 400', async () => {
  const admin = await createAdmin();
  const token = await login(admin);
  const res = await fetch(app.baseUrl + '/api/permission-groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ groups: 'not-an-array' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'invalid_groups');
});

test('POST /api/permission-groups/assign：missing usernames → 400', async () => {
  const admin = await createAdmin();
  const token = await login(admin);
  const res = await fetch(app.baseUrl + '/api/permission-groups/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ groupId: 'g1' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_usernames');
});

test('POST /api/permission-groups/assign：nothing_to_update → 400', async () => {
  const admin = await createAdmin();
  const token = await login(admin);
  const res = await fetch(app.baseUrl + '/api/permission-groups/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ usernames: ['someone'] }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'nothing_to_update');
});

test('PUT /api/permission-groups：admin [] → 200 ok', async () => {
  const admin = await createAdmin();
  const token = await login(admin);
  const res = await fetch(app.baseUrl + '/api/permission-groups', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ groups: [] }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
});
