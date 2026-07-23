/**
 * Wave 4q：agent-data（飞书表/桌访）域拆分验收集成测（对当前 index.js 已注册路由）。
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

test('GET /api/agent/feishu-table-data：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/agent/feishu-table-data?appToken=a&tableId=b');
  assert.equal(res.status, 401);
});

test('GET /api/agent/feishu-table-data：缺 appToken → 400 missing_params', async () => {
  const username = uniqueId('ad_ftd');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/agent/feishu-table-data?tableId=b', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_params');
});

test('GET /api/agent/table-visit-data：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/agent/table-visit-data');
  assert.equal(res.status, 401);
});

test('GET /api/agent/table-visit-data：有 token → 非 401', async () => {
  const username = uniqueId('ad_tvd');
  await createUser(username, 'store_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/agent/table-visit-data', {
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.notEqual(res.status, 401);
  if (res.status === 200) {
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data));
  }
});

test('POST /api/agent/feishu-table-write：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/agent/feishu-table-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appToken: 'a', tableId: 'b', fields: {} }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/agent/feishu-table-write：store_employee → 403', async () => {
  const username = uniqueId('ad_ftw_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/agent/feishu-table-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ appToken: 'a', tableId: 'b', fields: { x: 1 } }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/agent/feishu-table-write：admin 缺 appToken → 400', async () => {
  const username = uniqueId('ad_ftw_adm');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/agent/feishu-table-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ tableId: 'b', fields: { x: 1 } }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_app_token_or_table_id');
});
