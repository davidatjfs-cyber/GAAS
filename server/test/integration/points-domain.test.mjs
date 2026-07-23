/**
 * Wave 4b：points 域拆分验收集成测。
 * 覆盖：鉴权失败、规则写权限、合法列表/排行/我的积分。
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

test('GET /api/points/records：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/points/records');
  assert.equal(res.status, 401);
});

test('GET /api/points/records：普通员工 → 403', async () => {
  const username = uniqueId('pt_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/points/records', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/points/records：hq_manager → 200 + items', async () => {
  const username = uniqueId('pt_hq');
  await createUser(username, 'hq_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/points/records?recordStatus=approved', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.items), JSON.stringify(body).slice(0, 300));
  assert.ok(body.summary && typeof body.summary === 'object');
});

test('GET /api/points/ranking：登录后 → 200', async () => {
  const username = uniqueId('pt_rank');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/points/ranking?month=2026-07', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.month, '2026-07');
  assert.ok(Array.isArray(body.ranking));
});

test('GET /api/points/my：登录后 → 200', async () => {
  const username = uniqueId('pt_my');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/points/my', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.items));
  assert.ok(typeof body.monthPoints === 'number');
});

test('POST /api/points/rules：普通员工 → 403', async () => {
  const username = uniqueId('pt_rule_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/points/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ store: '测试店', itemName: '不应创建', points: 5 }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('POST /api/points/rules：admin 缺 itemName → 400', async () => {
  const username = uniqueId('pt_rule_bad');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/points/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ store: '测试店', points: 5 }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_item_name');
});

test('GET /api/points/rules：登录后 → 200 + items', async () => {
  const username = uniqueId('pt_rules');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/points/rules', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.items));
});
