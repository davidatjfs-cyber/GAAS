import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant, appendStateEmployee } from './helpers/db.mjs';

// P0覆盖：登录是几乎每个请求都会走的公共路径，也是这次密码迁移改造直接改过的代码。
// 覆盖三条真实存在的登录路径：users表(bcrypt) / hrms_state兜底(明文，改造后会自动迁移) / 找不到用户。

let app;

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('users表用户：正确密码登录成功，返回token', async () => {
  const db = testDb();
  const username = uniqueId('login_ok');
  const hash = await bcrypt.hash('CorrectPass123', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, $3, 'store_employee', true, 'default')`,
    [username, hash, '测试员工']
  );

  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'CorrectPass123' })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.token, '应返回token');
  assert.equal(body.user.username, username);
});

test('users表用户：密码错误返回401，不返回token', async () => {
  const db = testDb();
  const username = uniqueId('login_bad');
  const hash = await bcrypt.hash('CorrectPass123', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, $3, 'store_employee', true, 'default')`,
    [username, hash, '测试员工']
  );

  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'WrongPassword' })
  });
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.token, undefined);
});

test('不存在的用户名：不会泄露"用户不存在"和"密码错误"的区别（防止用户名枚举）', async () => {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uniqueId('nobody'), password: 'whatever123' })
  });
  const body = await res.json();
  assert.equal(res.status, 401);
  // 不应该有专门的"用户不存在"错误码，应该和密码错误返回同一种 invalid_credentials
  assert.equal(body.error, 'invalid_credentials');
});

test('hrms_state兜底登录：明文密码匹配成功后，自动把用户迁移进users表(bcrypt)', async () => {
  const db = testDb();
  const username = uniqueId('legacy_user');
  const tenantId = 'default';

  // 构造一个还没进users表、密码存在hrms_state明文字段的老用户
  await appendStateEmployee(tenantId, { username, password: 'LegacyPlainPass1', role: 'store_employee', name: '老用户' });

  // 登录前确认users表里还没有这个人
  const before = await db.query(`select 1 from users where username = $1`, [username]);
  assert.equal(before.rows.length, 0, '迁移前不应该已经在users表');

  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'LegacyPlainPass1' })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.token);

  // 登录成功的同时，应该已经被迁移进users表(bcrypt)
  const after = await db.query(`select password_hash from users where username = $1`, [username]);
  assert.equal(after.rows.length, 1, '登录成功后应该已自动迁移到users表');
  const isBcryptHash = /^\$2[aby]\$/.test(after.rows[0].password_hash);
  assert.ok(isBcryptHash, '迁移后的密码应该是bcrypt哈希，不是明文');
  assert.notEqual(after.rows[0].password_hash, 'LegacyPlainPass1');
});

test('hrms_state兜底登录：密码错误应拒绝，且不产生迁移', async () => {
  const db = testDb();
  const username = uniqueId('legacy_bad');
  const tenantId = 'default';

  await appendStateEmployee(tenantId, { username, password: 'RealPassword1', role: 'store_employee', name: '老用户2' });

  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'WrongGuess' })
  });
  assert.equal(res.status, 401);

  const after = await db.query(`select 1 from users where username = $1`, [username]);
  assert.equal(after.rows.length, 0, '密码错误不应该产生迁移');
});

async function loginOk(username, password) {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  return body.token;
}

test('GET /api/auth/me：无 token → 401；有 token → 200 含 username', async () => {
  const noAuth = await fetch(app.baseUrl + '/api/auth/me');
  assert.equal(noAuth.status, 401);

  const db = testDb();
  const username = uniqueId('me_ok');
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '我', 'store_employee', true, 'default')`,
    [username, hash]
  );
  const token = await loginOk(username, 'Pass12345');
  const res = await fetch(app.baseUrl + '/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.user?.username, username);
});

test('POST /api/auth/logout + heartbeat：登录后 200', async () => {
  const db = testDb();
  const username = uniqueId('lo_ok');
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '退', 'store_employee', true, 'default')`,
    [username, hash]
  );
  const token = await loginOk(username, 'Pass12345');

  const beat = await fetch(app.baseUrl + '/api/auth/heartbeat', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  const beatBody = await beat.json();
  assert.equal(beat.status, 200, JSON.stringify(beatBody));
  assert.equal(beatBody.ok, true);

  const out = await fetch(app.baseUrl + '/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  const outBody = await out.json();
  assert.equal(out.status, 200, JSON.stringify(outBody));
});

test('POST /api/auth/switch-store：缺 store→400；越权→403；允许门店→200 新 token', async () => {
  const db = testDb();
  const username = uniqueId('sw_mgr');
  const storeA = uniqueId('店A');
  const storeB = uniqueId('店B');
  const storeC = uniqueId('店C');
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '店长', 'store_manager', true, 'default')`,
    [username, hash]
  );
  await appendStateEmployee('default', {
    username,
    role: 'store_manager',
    store: storeA,
    name: '换店店长',
  });
  await db.query(
    `insert into store_duty_bindings
       (username, store, access_level, is_primary_store, enabled, tenant_id)
     values
       ($1, $2, 'primary', true, true, 'default'),
       ($1, $3, 'support', false, true, 'default')
     on conflict (username, store, tenant_id) do update
       set enabled = true, is_primary_store = excluded.is_primary_store`,
    [username, storeA, storeB]
  );

  const token = await loginOk(username, 'Pass12345');

  const missing = await fetch(app.baseUrl + '/api/auth/switch-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({}),
  });
  const missingBody = await missing.json();
  assert.equal(missing.status, 400, JSON.stringify(missingBody));
  assert.equal(missingBody.error, 'missing_store');

  const forbidden = await fetch(app.baseUrl + '/api/auth/switch-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ store: storeC }),
  });
  const forbiddenBody = await forbidden.json();
  assert.equal(forbidden.status, 403, JSON.stringify(forbiddenBody));
  assert.equal(forbiddenBody.error, 'store_forbidden');

  const okRes = await fetch(app.baseUrl + '/api/auth/switch-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ store: storeB }),
  });
  const okBody = await okRes.json();
  assert.equal(okRes.status, 200, JSON.stringify(okBody));
  assert.ok(okBody.token);
  assert.equal(okBody.user?.current_store, storeB);
});
