/**
 * Wave 4a：daily-reports 域拆分验收集成测。
 * 覆盖：鉴权失败、缺参、合法列表；写权限拒绝。
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

test('GET /api/daily-reports：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/daily-reports?date=2026-07-01');
  assert.equal(res.status, 401);
});

test('GET /api/daily-reports：普通员工 → 403', async () => {
  const username = uniqueId('dr_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/daily-reports?date=2026-07-01', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/daily-reports：store_manager 合法列表 → 200', async () => {
  const username = uniqueId('dr_mgr');
  await createUser(username, 'store_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/daily-reports?date=2026-07-01', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.items) || Array.isArray(body.rows) || body.ok === true,
    '应返回列表结构: ' + JSON.stringify(body).slice(0, 300));
});

test('POST /api/daily-reports：普通员工 → 403', async () => {
  const username = uniqueId('dr_write_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/daily-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ date: '2026-07-01', store: '测试店', data: {} }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('POST /api/daily-reports：store_manager 缺 date → 400', async () => {
  const username = uniqueId('dr_bad');
  await createUser(username, 'store_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/daily-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ store: '测试店', data: {} }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_date');
});

test('DELETE /api/daily-reports：非 admin → 403', async () => {
  const username = uniqueId('dr_del');
  await createUser(username, 'store_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/daily-reports?store=测试店&date=2026-07-01', {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('GET /api/daily-reports/private-room-month-total：缺参 → total 0', async () => {
  const username = uniqueId('dr_pr');
  await createUser(username, 'hq_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/daily-reports/private-room-month-total', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.total, 0);
});
