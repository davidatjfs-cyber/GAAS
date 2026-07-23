/**
 * Wave 2：training 域拆分验收集成测。
 * 覆盖：鉴权失败、知识点 CRUD 权限、合法创建、指派失败/成功。
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

async function ensureEmployee(username, { role = 'store_employee', name = '员工', store = '测试店' } = {}) {
  const db = testDb();
  const id = uniqueId('emp');
  await db.query(
    `insert into employees (id, username, name, role, store, tenant_id, status)
     values ($1, $2, $3, $4, $5, 'default', 'active')
     on conflict (username) do update set role = excluded.role, name = excluded.name, store = excluded.store, status = 'active'`,
    [id, username, name, role, store]
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

test('GET /api/training/topics：无 token → 401', async () => {
  const res = await fetch(app.baseUrl + '/api/training/topics');
  assert.equal(res.status, 401);
});

test('GET /api/training/topics：登录后 → 200 + success', async () => {
  const username = uniqueId('tr_list');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/training/topics', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.topics));
});

test('POST /api/training/topics：普通员工 → 403', async () => {
  const username = uniqueId('tr_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/training/topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ title: '不应创建', positions: ['收银'], description: 'x' }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('POST /api/training/topics：缺标题 → success=false', async () => {
  const username = uniqueId('tr_bad');
  await createUser(username, 'hq_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/training/topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ positions: ['收银'] }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.success, false);
  assert.match(String(body.error || ''), /标题|岗位/);
});

test('POST /api/training/topics：hq_manager 合法创建 → success + topic.id', async () => {
  const username = uniqueId('tr_hq');
  await createUser(username, 'hq_manager');
  const token = await login(username);
  const title = `Wave2知识点_${uniqueId('t')}`;
  const res = await fetch(app.baseUrl + '/api/training/topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      title,
      positions: ['收银'],
      description: '集成测',
      key_points: ['要点A'],
      sort_order: 0,
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.success, true, JSON.stringify(body));
  assert.ok(body.topic?.id, JSON.stringify(body));
  assert.equal(body.topic.title, title);
});

test('POST /api/training/assignments：员工无权限 → 403', async () => {
  const username = uniqueId('tr_asg_emp');
  await createUser(username, 'store_employee');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/training/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ employee_username: username, topic_id: 1 }),
  });
  const body = await res.json();
  assert.equal(res.status, 403, JSON.stringify(body));
});

test('POST /api/training/assignments：缺员工/知识点 → success=false', async () => {
  const username = uniqueId('tr_asg_bad');
  await createUser(username, 'hq_manager');
  const token = await login(username);
  const res = await fetch(app.baseUrl + '/api/training/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ topic_id: 1 }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.success, false);
});

test('POST /api/training/assignments：hq_manager 合法指派 → success', async () => {
  const manager = uniqueId('tr_asg_mgr');
  const employee = uniqueId('tr_asg_target');
  await createUser(manager, 'hq_manager');
  await createUser(employee, 'store_employee');
  await ensureEmployee(employee, { role: 'store_employee', name: '被指派员工' });

  const mgrToken = await login(manager);
  const topicRes = await fetch(app.baseUrl + '/api/training/topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken },
    body: JSON.stringify({
      title: `指派用知识点_${uniqueId('tp')}`,
      positions: ['收银'],
      description: 'asg',
    }),
  });
  const topicBody = await topicRes.json();
  assert.equal(topicBody.success, true, JSON.stringify(topicBody));
  const topicId = topicBody.topic.id;

  const res = await fetch(app.baseUrl + '/api/training/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + mgrToken },
    body: JSON.stringify({
      employee_usernames: [employee],
      topic_id: topicId,
      due_date: '2099-12-31',
      note: 'wave2',
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.success, true, JSON.stringify(body));
  assert.ok(body.count >= 1, JSON.stringify(body));
});
