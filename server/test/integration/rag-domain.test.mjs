/**
 * Wave 4p：RAG 域 HTTP 拆分验收集成测（对当前 index.js 已注册路由）。
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

test('GET /api/rag/stats：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/rag/stats');
  assert.equal(res.status, 401);
});

test('POST /api/rag/query：有 token 无 body.query → 400 query required', async () => {
  const username = uniqueId('rag_q');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/rag/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'query required');
});

test('POST /api/rag/multi-query：queries 非数组 → 400', async () => {
  const username = uniqueId('rag_mq');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/rag/multi-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ queries: 'not-an-array' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'queries array required');
});
