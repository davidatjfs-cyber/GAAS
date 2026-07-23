/**
 * Wave 4i prep：uploads 域 POST 路由验收集成测（对当前 index.js 已注册路由）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

const UPLOAD_POST_PATHS = [
  '/api/uploads/daily-report',
  '/api/uploads/employee-idcard',
  '/api/uploads/points-evidence',
  '/api/uploads/agent-task-evidence',
  '/api/uploads/ops-task-evidence',
];

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

test('POST /api/uploads/*：无 token → 401', async () => {
  for (const path of UPLOAD_POST_PATHS) {
    const form = new FormData();
    const res = await postMultipart(path, null, form);
    assert.equal(res.status, 401, path);
  }
});

test('POST /api/uploads/daily-report：store_employee → 403', async () => {
  const username = uniqueId('up_dr_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await postMultipart('/api/uploads/daily-report', token, new FormData());
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/uploads/agent-task-evidence：store_employee → 403', async () => {
  const username = uniqueId('up_agent_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await postMultipart('/api/uploads/agent-task-evidence', token, new FormData());
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/uploads/points-evidence：已鉴权无文件 → 400 missing_file', async () => {
  const username = uniqueId('up_pts_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await postMultipart('/api/uploads/points-evidence', token, new FormData());
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_file');
});

test('POST /api/uploads/ops-task-evidence：已鉴权无文件 → 400 missing_file', async () => {
  const username = uniqueId('up_ops_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await postMultipart('/api/uploads/ops-task-evidence', token, new FormData());
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_file');
});

test('POST /api/uploads/employee-idcard：store_manager 无文件 → 400 missing_file', async () => {
  const username = uniqueId('up_id_mgr');
  await createUser(username, 'store_manager');
  const token = await login(username);
  const res = await postMultipart('/api/uploads/employee-idcard', token, new FormData());
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_file');
});
