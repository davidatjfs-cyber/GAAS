import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId } from './helpers/db.mjs';

// 覆盖 migrations/149_fix_users_tenant_integrations_system_bypass.sql 这次修复：
// 1) 修复前：非default租户用户不显式传tenant_id登录会静默失败(lookupTenantIdByUsername
//    被RLS挡住返回0行，兜底成'default'，实际用户查不到)
// 2) 修复本身引入的新风险必须同时被堵住：'__system__'是内部专用哨兵值，客户端
//    绝不能在tenant_id/X-Tenant-Id里声称自己是这个身份——否则配合RLS里新加的
//    '__system__'例外条款，就是一条现成的越权读取所有租户users表的路径

let app;

test.before(async () => {
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('非default租户用户，登录时不传tenant_id，也应该能凭用户名查到正确租户并登录成功', async () => {
  const db = testDb();
  const tenantId = uniqueId('t');
  await db.query(
    `insert into tenants (tenant_id, name, status) values ($1, $2, 'active')
     on conflict (tenant_id) do update set status = 'active'`,
    [tenantId, '非default租户']
  );
  const username = uniqueId('nodef');
  const hash = await bcrypt.hash('SomePass123', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', 'store_employee', true, $3)`,
    [username, hash, tenantId]
  );

  // 关键：故意不传 tenant_id / X-Tenant-Id，模拟"客户端没显式指定"的场景
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'SomePass123' })
  });
  const body = await res.json();
  assert.equal(res.status, 200, '修复后应该能登录成功: ' + JSON.stringify(body));
  assert.equal(body.user.username, username);
});

test('客户端不能通过 tenant_id="__system__" 冒充系统身份', async () => {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'whoever', password: 'whatever123', tenant_id: '__system__' })
  });
  const body = await res.json();
  assert.equal(res.status, 400, '应该被拒绝，而不是被当成合法租户处理: ' + JSON.stringify(body));
  assert.equal(body.error, 'invalid_tenant_id');
});

test('客户端不能通过 X-Tenant-Id 请求头冒充系统身份', async () => {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': '__system__' },
    body: JSON.stringify({ username: 'whoever', password: 'whatever123' })
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'invalid_tenant_id');
});
