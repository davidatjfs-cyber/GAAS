/**
 * Wave 4k prep：员工附件 HTTP 验收集成测（对当前 index.js 已注册路由）。
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

async function postMultipart(path, token, formData) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(app.baseUrl + path, { method: 'POST', headers, body: formData });
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('GET /api/employees/:empId/attachments：无 token → 401', async () => {
  const empId = uniqueId('emp_att');
  const res = await fetch(app.baseUrl + '/api/employees/' + encodeURIComponent(empId) + '/attachments');
  assert.equal(res.status, 401);
});

test('GET /api/employees/:empId/attachments：store_employee → 403', async () => {
  const empId = uniqueId('emp_att');
  const username = uniqueId('att_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/employees/' + encodeURIComponent(empId) + '/attachments', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/employees/:empId/attachments：hq_manager → 403', async () => {
  const empId = uniqueId('emp_att');
  const username = uniqueId('att_hq');
  await createUser(username, 'hq_manager');
  const token = await login(username);
  const res = await postMultipart(
    '/api/employees/' + encodeURIComponent(empId) + '/attachments',
    token,
    new FormData()
  );
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/employees/:empId/attachments：admin 无文件 → 400 missing_file', async () => {
  const empId = uniqueId('emp_att');
  const username = uniqueId('att_admin');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await postMultipart(
    '/api/employees/' + encodeURIComponent(empId) + '/attachments',
    token,
    new FormData()
  );
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_file');
});

test('GET /api/employees/:empId/attachments：admin 无附件 → 200 空数组', async () => {
  const empId = uniqueId('emp_att_empty');
  const username = uniqueId('att_admin_get');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/employees/' + encodeURIComponent(empId) + '/attachments', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 0);
});
