/**
 * L3：routes-billing 资金路径集成测（收款账户 + 账单 PDF）。
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

async function platformToken(username, password = 'Pass12345') {
  const res = await fetch(app.baseUrl + '/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
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

test('billing-account：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/admin/platform/billing-account');
  assert.equal(res.status, 401);
});

test('billing-account：auditor 角色 → 403（非超管/总经/财务）', async () => {
  const username = uniqueId('padmin_aud');
  await createPlatformAdmin(username, { role: 'auditor' });
  const token = await platformToken(username);
  const res = await fetch(app.baseUrl + '/api/admin/platform/billing-account', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('billing-account：super_admin GET/PUT 往返', async () => {
  const username = uniqueId('padmin_bill');
  await createPlatformAdmin(username, { role: 'super_admin' });
  const token = await platformToken(username);

  const putRes = await fetch(app.baseUrl + '/api/admin/platform/billing-account', {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      account: {
        account_name: '上海测试商户',
        bank_name: '测试银行',
        bank_branch: '浦东支行',
        bank_account_no: '6222000012345678',
        notes: '集成测',
      },
    }),
  });
  const putBody = await putRes.json();
  assert.equal(putRes.status, 200, JSON.stringify(putBody));
  assert.equal(putBody.ok, true);
  assert.equal(putBody.account?.account_name, '上海测试商户');
  assert.equal(putBody.account?.bank_account_no, '6222000012345678');

  const getRes = await fetch(app.baseUrl + '/api/admin/platform/billing-account', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const getBody = await getRes.json();
  assert.equal(getRes.status, 200, JSON.stringify(getBody));
  assert.equal(getBody.account?.bank_name, '测试银行');
});

test('billing/pdf：未知租户 → 404', async () => {
  const username = uniqueId('padmin_pdf');
  await createPlatformAdmin(username);
  const token = await platformToken(username);
  const res = await fetch(app.baseUrl + '/api/admin/tenants/no-such-tenant-xyz/billing/pdf', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 404, JSON.stringify(body));
  assert.equal(body.error, 'tenant_not_found');
});

test('billing/pdf：default 租户 → PDF', async () => {
  const username = uniqueId('padmin_pdfok');
  await createPlatformAdmin(username);
  const token = await platformToken(username);
  const res = await fetch(app.baseUrl + '/api/admin/tenants/default/billing/pdf', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(res.status, 200, `status=${res.status} bytes=${buf.length}`);
  assert.match(String(res.headers.get('content-type') || ''), /pdf/i);
  assert.ok(buf.length > 100);
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});
