import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant, appendStateEmployee } from './helpers/db.mjs';

// P0覆盖：这次改造直接修复了 change-password 会把新密码明文写回 hrms_state 的问题，
// 这里验证修复后的实际行为，防止拆分/以后改动时这个bug被无意中带回来。

let app;

async function loginAndGetToken(baseUrl, username, password) {
  const res = await fetch(baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const body = await res.json();
  assert.equal(res.status, 200, 'login应成功: ' + JSON.stringify(body));
  return body.token;
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('users表用户改密码：不再把新密码明文写回hrms_state', async () => {
  const db = testDb();
  const username = uniqueId('chpwd_db');
  const oldHash = await bcrypt.hash('OldPass1234', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', 'store_employee', true, 'default')`,
    [username, oldHash]
  );

  const token = await loginAndGetToken(app.baseUrl, username, 'OldPass1234');

  const res = await fetch(app.baseUrl + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ oldPassword: 'OldPass1234', newPassword: 'NewPass5678' })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.mode, 'db');

  // 新密码应该能登录
  const relogin = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'NewPass5678' })
  });
  assert.equal(relogin.status, 200, '新密码应能登录');

  // hrms_state.employees/users 里不应该出现这个用户名对应的明文新密码
  const state = await db.query(`select data from hrms_state where key = 'default'`);
  const data = state.rows[0]?.data || {};
  const all = [].concat(data.employees || [], data.users || []);
  const found = all.find((u) => u.username === username);
  assert.ok(!found || found.password !== 'NewPass5678', 'hrms_state 不应该出现明文新密码');
});

test('hrms_state老用户改密码：迁移进users表(bcrypt)，不再写明文', async () => {
  const db = testDb();
  const username = uniqueId('chpwd_legacy');
  const tenantId = 'default';

  await appendStateEmployee(tenantId, { username, password: 'LegacyOld123', role: 'store_employee', name: '老用户改密' });

  const token = await loginAndGetToken(app.baseUrl, username, 'LegacyOld123');

  const res = await fetch(app.baseUrl + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ oldPassword: 'LegacyOld123', newPassword: 'LegacyNew456' })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  const dbUser = await db.query(`select password_hash from users where username = $1`, [username]);
  assert.equal(dbUser.rows.length, 1, '改密码后应该已经进入users表');
  const ok = await bcrypt.compare('LegacyNew456', dbUser.rows[0].password_hash);
  assert.ok(ok, 'users表里的哈希应该能验证新密码');
});

test('弱密码（不足8位或缺字母/数字）应被拒绝', async () => {
  const db = testDb();
  const username = uniqueId('chpwd_weak');
  const oldHash = await bcrypt.hash('OldPass1234', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', 'store_employee', true, 'default')`,
    [username, oldHash]
  );
  const token = await loginAndGetToken(app.baseUrl, username, 'OldPass1234');

  const res = await fetch(app.baseUrl + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ oldPassword: 'OldPass1234', newPassword: 'onlyletters' })
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'weak_password');
});

test('旧密码错误 → 400 old_password_invalid', async () => {
  const db = testDb();
  const username = uniqueId('chpwd_badold');
  const oldHash = await bcrypt.hash('OldPass1234', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', 'store_employee', true, 'default')`,
    [username, oldHash]
  );
  const token = await loginAndGetToken(app.baseUrl, username, 'OldPass1234');

  const res = await fetch(app.baseUrl + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ oldPassword: 'WrongOld9999', newPassword: 'NewPass5678' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'old_password_invalid');
});
