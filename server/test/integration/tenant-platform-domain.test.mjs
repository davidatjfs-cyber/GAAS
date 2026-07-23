/**
 * Wave 1：tenant-platform 域拆分验收集成测。
 * 覆盖：登录失败/成功、租户列表鉴权、无效租户创建、合法开通。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

let app;

async function createPlatformAdmin(username, { role = 'super_admin', password = 'Pass12345' } = {}) {
  const db = testDb();
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO platform_admins (username, password_hash, real_name, role, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, status = 'active'`,
    [username, hash, username, role]
  );
  return username;
}

async function platformLogin(username, password = 'Pass12345') {
  const res = await fetch(app.baseUrl + '/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  return { res, body };
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('平台登录：缺凭证 → 400 missing_credentials', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'x' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_credentials');
});

test('平台登录：错误密码 → 401 invalid_credentials', async () => {
  const username = uniqueId('padmin_bad');
  await createPlatformAdmin(username);
  const { res, body } = await platformLogin(username, 'WrongPass99');
  assert.equal(res.status, 401, JSON.stringify(body));
  assert.equal(body.error, 'invalid_credentials');
});

test('平台登录：正确密码 → 200 返回 token', async () => {
  const username = uniqueId('padmin_ok');
  await createPlatformAdmin(username);
  const { res, body } = await platformLogin(username);
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.ok(body.token, '应返回 JWT');
  assert.equal(body.admin?.username, username);
  assert.equal(body.admin?.role, 'super_admin');
});

test('GET /api/admin/tenants：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/tenants');
  const body = await res.json();
  assert.equal(res.status, 401, JSON.stringify(body));
  assert.equal(body.error, 'unauthorized');
});

test('GET /api/admin/tenants：super_admin 登录后 → 200', async () => {
  const username = uniqueId('padmin_list');
  await createPlatformAdmin(username);
  const { body: loginBody } = await platformLogin(username);
  assert.ok(loginBody.token);

  const res = await fetch(app.baseUrl + '/api/admin/tenants', {
    headers: { Authorization: 'Bearer ' + loginBody.token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.items), '应返回 items 数组: ' + JSON.stringify(body).slice(0, 200));
});

test('POST /api/admin/tenants：非法 tenant_id → 400', async () => {
  const username = uniqueId('padmin_badtid');
  await createPlatformAdmin(username);
  const { body: loginBody } = await platformLogin(username);

  const res = await fetch(app.baseUrl + '/api/admin/tenants', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + loginBody.token,
    },
    body: JSON.stringify({
      tenant_id: 'bad id!!',
      name: '坏租户',
      create_admin: { username: uniqueId('tadmin'), password: 'Pass12345' },
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'invalid_tenant_id');
});

test('POST /api/admin/tenants：缺 create_admin → 400 missing_admin', async () => {
  const username = uniqueId('padmin_noadm');
  await createPlatformAdmin(username);
  const { body: loginBody } = await platformLogin(username);
  const tid = uniqueId('tid');

  const res = await fetch(app.baseUrl + '/api/admin/tenants', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + loginBody.token,
    },
    body: JSON.stringify({ tenant_id: tid, name: '无管理员租户' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_admin');
});

test('POST /api/admin/tenants：合法开通 → 200/201 且可再查到', async () => {
  const username = uniqueId('padmin_create');
  await createPlatformAdmin(username);
  const { body: loginBody } = await platformLogin(username);
  const tid = uniqueId('newt');
  const adminUser = uniqueId('tadm');

  const createRes = await fetch(app.baseUrl + '/api/admin/tenants', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + loginBody.token,
    },
    body: JSON.stringify({
      tenant_id: tid,
      name: 'Wave1测试租户',
      create_admin: { username: adminUser, password: 'Pass12345', real_name: '租户管理员' },
    }),
  });
  const createBody = await createRes.json();
  assert.ok([200, 201].includes(createRes.status), JSON.stringify(createBody));
  assert.ok(createBody.ok !== false, JSON.stringify(createBody));

  const listRes = await fetch(app.baseUrl + '/api/admin/tenants', {
    headers: { Authorization: 'Bearer ' + loginBody.token },
  });
  const listBody = await listRes.json();
  assert.equal(listRes.status, 200, JSON.stringify(listBody));
  assert.ok(Array.isArray(listBody.items), JSON.stringify(listBody).slice(0, 200));
  assert.ok(
    listBody.items.some((t) => String(t.tenant_id) === tid),
    '列表应包含新建租户: ' + JSON.stringify(listBody).slice(0, 400)
  );
});
