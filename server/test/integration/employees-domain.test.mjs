import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

let app;

async function createAdmin() {
  const db = testDb();
  const username = uniqueId('admin');
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '管理员', 'admin', true, 'default')`,
    [username, hash]
  );
  return username;
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

test('员工窄 API：创建/改状态/读表 hydrate/DELETE；PUT /api/state 不能改 employees', async () => {
  const db = testDb();
  const admin = await createAdmin();
  const token = await login(admin);
  const uname = uniqueId('emp');

  const createRes = await fetch(app.baseUrl + '/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      employee: {
        username: uname,
        name: '测试员工',
        role: 'staff',
        store: '洪潮店',
        status: 'active',
        password: 'init123',
      }
    })
  });
  const createBody = await createRes.json();
  assert.equal(createRes.status, 201, JSON.stringify(createBody));
  assert.equal(createBody.employee?.username, uname);

  const tableRow = await db.query(
    `select name, status, password_hash from employees where lower(username)=lower($1) and tenant_id='default'`,
    [uname]
  );
  assert.equal(tableRow.rows[0]?.name, '测试员工');
  assert.equal(tableRow.rows[0]?.password_hash, 'init123');

  const patchRes = await fetch(app.baseUrl + '/api/employees/' + encodeURIComponent(uname) + '/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ status: 'inactive' })
  });
  const patchBody = await patchRes.json();
  assert.equal(patchRes.status, 200, JSON.stringify(patchBody));
  assert.equal(patchBody.employee?.status, 'inactive');
  const afterPatch = await db.query(
    `select status from employees where lower(username)=lower($1) and tenant_id='default'`,
    [uname]
  );
  assert.equal(afterPatch.rows[0]?.status, 'inactive', 'PATCH 后权威表 status 必须为 inactive');

  const putRes = await fetch(app.baseUrl + '/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      data: {
        employees: [{ username: uname, name: '黑客改名', status: 'active' }],
        settings: { theme: 'employees-a1' },
      }
    })
  });
  const putBody = await putRes.json();
  assert.equal(putRes.status, 200, JSON.stringify(putBody));
  assert.ok(putBody.ignoredKeys?.includes('employees'));

  const getRes = await fetch(app.baseUrl + '/api/state', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const getBody = await getRes.json();
  assert.equal(getRes.status, 200, JSON.stringify(getBody));
  const emp = (getBody.data?.employees || []).find((e) => String(e.username).toLowerCase() === uname.toLowerCase());
  assert.ok(emp, 'GET /api/state 应从表 hydrate 出员工');
  assert.equal(emp.name, '测试员工');
  assert.equal(emp.status, 'inactive');

  const delRes = await fetch(app.baseUrl + '/api/employees/' + encodeURIComponent(uname), {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  assert.equal(delRes.status, 200, await delRes.text());
  const gone = await db.query(
    `select 1 from employees where lower(username)=lower($1) and tenant_id='default'`,
    [uname]
  );
  assert.equal(gone.rowCount, 0);
});
