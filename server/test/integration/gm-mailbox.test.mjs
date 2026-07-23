/**
 * Wave 4d：gm-mailbox 域拆分验收集成测。
 * 覆盖：鉴权失败、内容校验、匿名投递 happy path。
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

test('POST /api/gm-mailbox：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/gm-mailbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'hello world' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/gm-mailbox：空 content → 400 missing_content', async () => {
  const username = uniqueId('gm_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/gm-mailbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ content: '' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_content');
});

test('POST /api/gm-mailbox：content 长度 4 → 400 content_too_short', async () => {
  const username = uniqueId('gm_short');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/gm-mailbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ content: 'abcd' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'content_too_short');
});

test('POST /api/gm-mailbox：store_employee 合法内容 → 200 ok+id，hrms_state 写入 gmMailbox', async () => {
  const username = uniqueId('gm_ok');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const content = '这是一条匿名总经理信箱测试留言';
  const res = await fetch(app.baseUrl + '/api/gm-mailbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ content }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.ok(typeof body.id === 'string' && body.id.length > 0);

  const db = testDb();
  const row = await db.query(`select data from hrms_state where key = 'default'`);
  assert.ok(row.rows.length >= 1, 'hrms_state default row missing');
  const data = row.rows[0].data;
  const mailbox = data?.gmMailbox;
  assert.ok(Array.isArray(mailbox) && mailbox.length >= 1, JSON.stringify(data?.gmMailbox).slice(0, 200));
  const first = mailbox[0];
  assert.equal(first.content, content);
  assert.equal(first.applicantUsername, username);
  assert.equal(first.id, body.id);
});
