/**
 * Wave 4p：Feishu sync HTTP 域拆分验收集成测（对当前 index.js 已注册路由）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

let app;

async function ensureUsersRoleCheckIncludesHrManager() {
  const db = testDb();
  await db.query(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
      (role)::text = ANY (ARRAY[
        'admin'::varchar, 'hq_manager'::varchar, 'store_manager'::varchar,
        'hq_employee'::varchar, 'store_employee'::varchar, 'hr_manager'::varchar
      ]::text[])
    );
  `);
}

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
  await ensureUsersRoleCheckIncludesHrManager();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('GET /api/feishu/sync-status：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/feishu/sync-status');
  assert.equal(res.status, 401);
});

test('GET /api/feishu/sync-status：store_employee → 403', async () => {
  const username = uniqueId('fs_emp_st');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/feishu/sync-status', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/feishu/sync-manual：store_employee → 403', async () => {
  const username = uniqueId('fs_emp_sm');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/feishu/sync-manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ appToken: 'x', tableId: 'y' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/feishu/sync-manual：admin 缺 appToken/tableId → 400 missing_app_token_or_table_id', async () => {
  const username = uniqueId('fs_adm_sm');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/feishu/sync-manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_app_token_or_table_id');
});

test('POST /api/feishu/test-connection：store_employee → 403', async () => {
  const username = uniqueId('fs_emp_tc');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/feishu/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ appId: 'a', appSecret: 'b' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/feishu/test-connection：admin 缺 appId → 400 missing_app_id_or_secret', async () => {
  const username = uniqueId('fs_adm_tc');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/feishu/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_app_id_or_secret');
});
