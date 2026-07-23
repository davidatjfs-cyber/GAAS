/**
 * Wave 4o：exam-results 域拆分验收集成测（对当前 index.js 已注册路由，接线后行为一致）。
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

test('GET /api/exam-results：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/exam-results');
  assert.equal(res.status, 401);
});

test('POST /api/exam-results：缺 total/score → 400 missing_fields', async () => {
  const username = uniqueId('exam_miss');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/exam-results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ correct: 5 }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_fields');
});

test('POST + GET /api/exam-results：store_employee 写入并读回自己的记录', async () => {
  const username = uniqueId('exam_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const postRes = await fetch(app.baseUrl + '/api/exam-results', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      total: 10,
      correct: 8,
      score: 80,
      answers: [{ q: 1, a: 'A' }],
    }),
  });
  const postBody = await postRes.json();
  assert.equal(postRes.status, 200, JSON.stringify(postBody));
  assert.ok(postBody.item?.id, JSON.stringify(postBody));
  assert.equal(postBody.item.user_key, username);
  assert.equal(postBody.item.total, 10);
  assert.equal(postBody.item.score, 80);

  const getRes = await fetch(app.baseUrl + '/api/exam-results', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const getBody = await getRes.json();
  assert.equal(getRes.status, 200, JSON.stringify(getBody));
  assert.ok(Array.isArray(getBody.items), JSON.stringify(getBody).slice(0, 300));
  const found = getBody.items.find((row) => row.id === postBody.item.id);
  assert.ok(found, 'GET 应包含刚 POST 的记录');
  assert.equal(found.score, 80);
});
