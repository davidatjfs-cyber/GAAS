/**
 * Wave 4g：stores 域 CRUD/brands 拆分验收集成测（对当前 index.js 已注册路由）。
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
  const username = uniqueId('stores_admin');
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

test('GET /api/stores：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/stores');
  assert.equal(res.status, 401);
});

test('POST /api/stores：store_employee → 403', async () => {
  const username = uniqueId('stores_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/stores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name: '测试店' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('POST /api/stores：admin 缺 name → 400 missing_name', async () => {
  const admin = await createAdmin();
  const token = await login(admin);
  const res = await fetch(app.baseUrl + '/api/stores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ address: '某地' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_name');
});

test('GET /api/brands：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/brands');
  assert.equal(res.status, 401);
});

test('POST /api/brands：store_employee → 403', async () => {
  const username = uniqueId('brands_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/brands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name: '新品牌' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('GET/POST /api/brands：admin 创建后列表可见', async () => {
  const admin = await createAdmin();
  const token = await login(admin);
  const name = uniqueId('品牌');
  const create = await fetch(app.baseUrl + '/api/brands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name }),
  });
  const created = await create.json();
  assert.equal(create.status, 200, JSON.stringify(created));
  assert.equal(created.ok, true);
  assert.equal(created.item?.name, name);

  const list = await fetch(app.baseUrl + '/api/brands', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await list.json();
  assert.equal(list.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.some((b) => b.name === name), '新建品牌应出现在列表');
});

test('POST /api/stores/:name/location：store_employee → 403', async () => {
  const username = uniqueId('loc_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/stores/' + encodeURIComponent('洪潮店') + '/location', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ latitude: 31.2, longitude: 121.5 }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('GET /api/stores：admin → 200 items 数组', async () => {
  const admin = await createAdmin();
  const token = await login(admin);
  const res = await fetch(app.baseUrl + '/api/stores', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.items), 'items 应为数组');
});
