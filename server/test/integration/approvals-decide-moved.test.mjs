import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, ensureDefaultTenant } from './helpers/db.mjs';

/**
 * P0-A1：decide 路由已从 index.js 拆至 server/domains/approvals/。
 * 完整审批流转仍由 approvals-leave.test.mjs 覆盖；此处补一条拆后冒烟。
 */

let app;

async function createUser(username, role, tenantId = 'default') {
  const db = testDb();
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', $3, true, $4)
     on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [username, hash, role, tenantId]
  );
}

async function login(username) {
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Pass12345' })
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

test('decide：不存在的审批单应返回 404 not_found', async () => {
  const managerUsername = `decide404_${Date.now()}`;
  await createUser(managerUsername, 'hq_manager');

  const token = await login(managerUsername);
  const fakeId = '00000000-0000-4000-8000-000000000000';
  const res = await fetch(app.baseUrl + `/api/approvals/${fakeId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ approved: true })
  });
  const body = await res.json();
  assert.equal(res.status, 404, JSON.stringify(body));
  assert.equal(body.error, 'not_found');
});
