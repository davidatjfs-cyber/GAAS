/**
 * Wave 4f：payments 域拆分验收集成测（test-first，当前仍由 index.js 提供路由）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
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

async function insertApprovedPayment({ applicant = 'applicant1', assignee = 'admin1' } = {}) {
  const db = testDb();
  const id = randomUUID();
  const chain = [{ step: 1, assignee, status: 'approved' }];
  const payload = {
    date: '2026-07-15',
    store: '测试店',
    category: '物料',
    amount: 100,
    payee: '供应商A',
    urgency: 'normal',
    note: 'wave4f pay test',
  };
  await db.query(
    `insert into approval_requests
       (id, type, status, applicant_username, current_assignee_username, chain, payload, tenant_id)
     values ($1,'payment','approved',$2,$3,$4::jsonb,$5::jsonb,'default')`,
    [id, applicant, assignee, JSON.stringify(chain), JSON.stringify(payload)]
  );
  return id;
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('GET /api/payments/budget-summary：无 token → 401', async () => {
  const res = await fetch(
    app.baseUrl + '/api/payments/budget-summary?store=x&month=2026-07&category=y'
  );
  assert.equal(res.status, 401);
});

test('GET /api/payments/budget-summary：缺 store/month/category → 400 missing_params', async () => {
  const username = uniqueId('pay_bs');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/payments/budget-summary', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_params');
});

test('POST /api/payments/:id/pay：store_employee → 403', async () => {
  const username = uniqueId('pay_forbid');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/payments/' + randomUUID() + '/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ note: '' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/payments/export：store_employee → 403', async () => {
  const username = uniqueId('pay_exp_forbid');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(
    app.baseUrl + '/api/payments/export?start=2026-07-01&end=2026-07-31',
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('GET /api/payments/export：admin 缺日期 → 400 missing_date_range', async () => {
  const username = uniqueId('pay_exp_admin');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/payments/export', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_date_range');
});

test('POST /api/payments/:id/pay：已审批 payment → paid', async () => {
  const adminUser = uniqueId('pay_admin');
  await createUser(adminUser, 'admin');
  const token = await login(adminUser);
  const paymentId = await insertApprovedPayment({ applicant: uniqueId('pay_applicant') });

  const res = await fetch(app.baseUrl + '/api/payments/' + paymentId + '/pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ note: '已打款' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.item?.status, 'paid');
  assert.equal(body.item?.id, paymentId);
  assert.ok(body.item?.payload?.paidAt);
  assert.equal(body.item?.payload?.paidBy, adminUser);
});
