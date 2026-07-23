/**
 * Wave 3：reports 域拆分验收集成测。
 * 覆盖：鉴权失败、business/payroll 缺参、合法查询；含 payroll 通过+拒绝。
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

test('GET /api/reports/business：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/reports/business?start=2026-07-01&end=2026-07-07');
  assert.equal(res.status, 401);
});

test('GET /api/reports/business：普通员工 → 403', async () => {
  const username = uniqueId('rp_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/reports/business?start=2026-07-01&end=2026-07-07', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/reports/business：admin 缺日期范围 → 400 missing_range', async () => {
  const username = uniqueId('rp_biz_bad');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/reports/business', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_range');
});

test('GET /api/reports/business：admin 合法查询 → 200', async () => {
  const username = uniqueId('rp_biz_ok');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/reports/business?start=2026-07-01&end=2026-07-07', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.ok === true || Array.isArray(body.items) || Array.isArray(body.rows) || body.byStore || body.summary,
    '应返回报表结构: ' + JSON.stringify(body).slice(0, 300));
});

test('GET /api/reports/payroll：普通员工 → 403', async () => {
  const username = uniqueId('rp_pay_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/reports/payroll?month=2026-07', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/reports/payroll：admin 缺 month → 400 missing_month', async () => {
  const username = uniqueId('rp_pay_bad');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/reports/payroll', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_month');
});

test('GET /api/reports/payroll：admin 合法查询 → 200', async () => {
  const username = uniqueId('rp_pay_ok');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/reports/payroll?month=2026-07', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(
    body.ok === true || Array.isArray(body.items) || Array.isArray(body.rows) || body.payroll || body.month,
    '应返回薪资报表结构: ' + JSON.stringify(body).slice(0, 400)
  );
});

test('POST /api/reports/bi/trigger-weekly：非 admin → 403 admin_only', async () => {
  const username = uniqueId('rp_bi');
  await createUser(username, 'hq_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/reports/bi/trigger-weekly', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'admin_only');
});
