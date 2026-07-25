/**
 * Wave 4j：ops-tasks 域 HTTP 拆分验收集成测（对当前 index.js 已注册路由）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
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

async function seedOpenOpsTask(assigneeUsername) {
  const db = testDb();
  const id = randomUUID();
  const dedupe = uniqueId('ops_dedupe');
  const bizDate = new Date().toISOString().slice(0, 10);
  await db.query(
    `insert into ops_tasks (
       id, biz_date, store, brand, task_type, schedule_key, dedupe_key, title,
       assignee_username, assignee_role, status, due_at, tenant_id
     ) values (
       $1, $2::date, '测试店', '测试品牌', 'daily_check', 'test_sched', $3, '集成测任务',
       $4, 'store_manager', 'open', now() + interval '1 day', 'default'
     )`,
    [id, bizDate, dedupe, assigneeUsername]
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

test('GET /api/ops/tasks：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/ops/tasks');
  assert.equal(res.status, 401);
});

test('GET /api/ops/tasks：store_employee → 403', async () => {
  const username = uniqueId('ops_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/ops/tasks', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
  assert.equal(body.error, 'forbidden');
});

test('POST /api/ops/tasks/:id/read：登录 → 200 且 user_reads 落库', async () => {
  const db = testDb();
  const manager = uniqueId('ops_read');
  await createUser(manager, 'hq_manager');
  const taskId = await seedOpenOpsTask(manager);
  const token = await login(manager);

  const res = await fetch(app.baseUrl + '/api/ops/tasks/' + encodeURIComponent(taskId) + '/read', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);

  const row = await db.query(
    `select 1 from user_reads
      where username = $1 and module = 'ops_tasks' and item_key = $2`,
    [manager, taskId]
  );
  assert.equal(row.rows.length, 1);

  const again = await fetch(app.baseUrl + '/api/ops/tasks/' + encodeURIComponent(taskId) + '/read', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  assert.equal(again.status, 200);
});

test('GET /api/ops/tasks：hq_manager → 200 且能看到种子任务', async () => {
  const manager = uniqueId('ops_list');
  await createUser(manager, 'hq_manager');
  const taskId = await seedOpenOpsTask(manager);
  const token = await login(manager);
  const res = await fetch(app.baseUrl + '/api/ops/tasks?status=open', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.items));
  assert.ok(body.items.some((t) => t.id === taskId), '列表应含刚种子的 open 任务');
});

test('POST /api/ops/tasks/:id/complete：hq_manager 缺 evidence → 400 missing_evidence', async () => {
  const manager = uniqueId('ops_hq');
  const assignee = uniqueId('ops_assignee');
  await createUser(manager, 'hq_manager');
  await createUser(assignee, 'store_manager');
  const taskId = await seedOpenOpsTask(assignee);
  const token = await login(manager);
  const res = await fetch(app.baseUrl + '/api/ops/tasks/' + encodeURIComponent(taskId) + '/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ note: '无附件' }),
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.equal(body.error, 'missing_evidence');
});
