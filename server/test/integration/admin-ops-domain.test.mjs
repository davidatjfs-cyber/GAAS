/**
 * Wave 4q：admin-ops 域拆分验收集成测（对当前 index.js 已注册路由）。
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

test('POST /api/admin/leave-close-snapshot/recompute：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/leave-close-snapshot/recompute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: '2024-01' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/admin/leave-close-snapshot/recompute：store_employee → 403 admin_only', async () => {
  const username = uniqueId('ao_lc_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/leave-close-snapshot/recompute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ month: '2024-01' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'admin_only');
});

test('POST /api/admin/leave-close-snapshot/recompute：admin 缺 month → 400 missing_month', async () => {
  const username = uniqueId('ao_lc_adm');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/leave-close-snapshot/recompute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_month');
});

test('POST /api/admin/sales-raw/run-folder-import：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/sales-raw/run-folder-import', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST /api/admin/sales-raw/run-folder-import：store_employee → 403', async () => {
  const username = uniqueId('ao_sr_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/sales-raw/run-folder-import', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/admin/employee-password/:username：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/employee-password/someuser');
  assert.equal(res.status, 401);
});

test('GET /api/admin/employee-password/:username：store_employee → 403', async () => {
  const username = uniqueId('ao_pw_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/employee-password/other', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/admin/employee-password/:username：admin 查自身 → 200', async () => {
  const username = uniqueId('ao_pw_adm');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/employee-password/' + encodeURIComponent(username), {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok('password' in body);
  assert.equal(body.username, username);
});

test('POST /api/admin/system-alert/test：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/system-alert/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/admin/system-alert/test：store_employee → 403', async () => {
  const username = uniqueId('ao_sa_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/system-alert/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ username: 'admin' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/admin/system-alert/test：admin 缺 username → 400 missing_username', async () => {
  const username = uniqueId('ao_sa_adm');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/system-alert/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_username');
});

test('POST /api/admin/reconcile-daily-attendance-register-from-pg：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/reconcile-daily-attendance-register-from-pg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});

test('POST /api/admin/reconcile-daily-attendance-register-from-pg：store_employee → 403', async () => {
  const username = uniqueId('ao_rec_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/reconcile-daily-attendance-register-from-pg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});
