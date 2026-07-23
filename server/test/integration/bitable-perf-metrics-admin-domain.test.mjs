/**
 * Wave 4p：bitable / perf / metrics 管理面 HTTP 拆分验收集成测（对当前 index.js 已注册路由）。
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

test('GET /api/bitable/stats：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/bitable/stats');
  assert.equal(res.status, 401);
});

test('GET /api/bitable/stats：store_employee → 403', async () => {
  const username = uniqueId('bt_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/bitable/stats', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/bitable/stats：admin 非 403（测试库可能 500）', async () => {
  const username = uniqueId('bt_adm');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/bitable/stats', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.notEqual(res.status, 403, JSON.stringify(body));
  if (res.status === 200) {
    assert.equal(body.ok, true);
  }
});

test('POST /api/admin/perf/dish-weekly/resend：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/perf/dish-weekly/resend', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST /api/admin/perf/dish-weekly/resend：store_employee → 403', async () => {
  const username = uniqueId('pf_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/perf/dish-weekly/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/admin/perf/dish-weekly/resend：admin 非法 weekStart → 400 bad_range', async () => {
  const username = uniqueId('pf_adm');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/perf/dish-weekly/resend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ weekStart: 'not-a-date', weekEnd: '2026-01-07' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'bad_range');
});

test('POST /api/admin/metrics/bump-version：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/metrics/bump-version', { method: 'POST' });
  assert.equal(res.status, 401);
});

test('POST /api/admin/metrics/bump-version：store_employee → 403', async () => {
  const username = uniqueId('mt_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/metrics/bump-version', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ metric_id: 'test_metric' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/admin/metrics/bump-version：admin 缺 metric_id → 400', async () => {
  const username = uniqueId('mt_adm');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/admin/metrics/bump-version', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing metric_id');
});
