/**
 * Wave 4e prep：POST /api/training/tasks/batch 集成测（当前仍由 index.js 注册）。
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

/** 保留 state?.data?.employees 路径：hrms_state.data 顶层含嵌套 data 对象 */
async function seedNestedStateEmployees(employees, users = []) {
  const db = testDb();
  const nested = JSON.stringify({ employees, users });
  await db.query(
    `insert into hrms_state (key, data)
     values ('default', jsonb_set(coalesce('{}'::jsonb, '{}'::jsonb), '{data}', $1::jsonb))
     on conflict (key) do update
     set data = jsonb_set(coalesce(hrms_state.data, '{}'::jsonb), '{data}', $1::jsonb)`,
    [nested]
  );
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('POST /api/training/tasks/batch：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/training/tasks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'onboarding', title: '测', target_role: 'store_employee' }),
  });
  assert.equal(res.status, 401);
});

test('POST /api/training/tasks/batch：store_employee → 403', async () => {
  const username = uniqueId('tr_batch_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/training/tasks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ type: 'onboarding', title: '测', target_role: 'store_employee' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/training/tasks/batch：admin 缺字段 → 400 missing_fields', async () => {
  const username = uniqueId('tr_batch_bad');
  await createUser(username, 'admin');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/training/tasks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ title: '只有标题' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_fields');
});

test('POST /api/training/tasks/batch：admin + 嵌套 state.data.employees → 200 并写入 training_tasks', async () => {
  const assignee = uniqueId('tr_batch_tgt');
  await seedNestedStateEmployees([
    {
      username: assignee,
      role: 'store_employee',
      status: '在职',
      store: '测试店',
    },
  ]);

  const adminUser = uniqueId('tr_batch_adm');
  await createUser(adminUser, 'admin');
  const token = await login(adminUser);

  const title = `批量培训_${uniqueId('t')}`;
  const res = await fetch(app.baseUrl + '/api/training/tasks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      type: 'compliance',
      title,
      target_role: 'store_employee',
      due_date: '2026-08-01',
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.success, true, JSON.stringify(body));
  assert.ok(body.count >= 1, JSON.stringify(body));

  const db = testDb();
  const rows = await db.query(
    `select count(*)::int as n from training_tasks where assignee_username = $1 and title = $2`,
    [assignee, title]
  );
  assert.ok(rows.rows[0].n >= 1, `expected training_tasks for ${assignee}, got ${rows.rows[0].n}`);
});
