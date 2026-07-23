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

test('PUT /api/state 白名单：不能覆盖 roleModules/approvalFlows/pointRecords/employees', async () => {
  const db = testDb();
  const marker = uniqueId('flow');
  await db.query(
    `insert into hrms_state (key, data)
     values ('default', $1::jsonb)
     on conflict (key) do update set data = excluded.data`,
    [JSON.stringify({
      roleModules: { admin: ['keep-modules'] },
      approvalFlows: { leave: [marker] },
      paymentFlowByStore: { 测试店: ['keeper'] },
      pointRecords: [{ id: 'pr_keep', points: 42 }],
      payrollAdjustments: { '2026-07': { keep: true } },
      employees: [{ username: 'keep_emp', name: '保留员工' }],
      settings: { theme: 'old' },
    })]
  );

  const admin = await createAdmin();
  const token = await login(admin);
  const putRes = await fetch(app.baseUrl + '/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      data: {
        roleModules: { admin: ['HACKED'] },
        approvalFlows: { leave: ['HACKED'] },
        paymentFlowByStore: { 测试店: ['HACKED'] },
        pointRecords: [{ id: 'pr_keep', points: -1 }],
        payrollAdjustments: { '2026-07': { keep: false } },
        employees: [{ username: 'keep_emp', name: '改名员工' }, { username: 'new_emp', name: '新员工' }],
        settings: { theme: 'new' },
        totallyNewKey: 'should-not-persist',
      }
    })
  });
  const putBody = await putRes.json();
  assert.equal(putRes.status, 200, JSON.stringify(putBody));
  assert.ok(Array.isArray(putBody.ignoredKeys));
  assert.ok(putBody.ignoredKeys.includes('roleModules'));
  assert.ok(putBody.ignoredKeys.includes('pointRecords'));
  assert.ok(putBody.ignoredKeys.includes('employees'));
  assert.ok(putBody.ignoredKeys.includes('totallyNewKey'));

  const row = await db.query(`select data from hrms_state where key = 'default'`);
  const data = row.rows[0]?.data || {};
  assert.deepEqual(data.roleModules, { admin: ['keep-modules'] });
  assert.equal(data.approvalFlows?.leave?.[0], marker);
  assert.deepEqual(data.paymentFlowByStore, { 测试店: ['keeper'] });
  assert.equal(data.pointRecords?.[0]?.points, 42);
  assert.equal(data.payrollAdjustments?.['2026-07']?.keep, true);
  assert.equal(data.settings?.theme, 'new');
  assert.equal(data.totallyNewKey, undefined);
  assert.ok(data.employees.some((e) => e.username === 'keep_emp' && e.name === '保留员工'));
  assert.ok(!data.employees.some((e) => e.username === 'new_emp'));
});
