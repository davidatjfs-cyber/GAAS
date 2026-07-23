import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

let app;
let tenantId;

async function createAdmin() {
  const db = testDb();
  const username = uniqueId('admin');
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '管理员', 'admin', true, $3)`,
    [username, hash, tenantId]
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
  const db = testDb();
  tenantId = uniqueId('put_tenant');
  await db.query(
    `insert into tenants (tenant_id, name, status) values ($1, 'state-put隔离租户', 'active')
     on conflict (tenant_id) do update set status = 'active'`,
    [tenantId]
  );
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('PUT /api/state 白名单：不能覆盖 roleModules/approvalFlows/pointRecords/employees', async () => {
  const db = testDb();
  const marker = uniqueId('flow');
  const keepPointId = randomUUID();
  const keepEmp = uniqueId('keep_emp');

  await db.query(
    `insert into point_records
       (id, username, name, store, item_name, reason, points, amount, approved_by, tenant_id)
     values ($1::uuid, $2, '保留员工', '测试店', '保留事项', 'seed', 42, 21, 'admin', $3)`,
    [keepPointId, keepEmp, tenantId]
  );

  await db.query(
    `insert into hrms_state (key, data)
     values ($1, $2::jsonb)
     on conflict (key) do update set data = excluded.data`,
    [tenantId, JSON.stringify({
      roleModules: { admin: ['keep-modules'] },
      approvalFlows: { leave: [marker] },
      paymentFlowByStore: { 测试店: ['keeper'] },
      pointRecords: [{ id: keepPointId, points: 42 }],
      payrollAdjustments: { '2026-07': { keep: true } },
      employees: [{ username: keepEmp, name: '保留员工' }],
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
        pointRecords: [{ id: keepPointId, points: -1 }],
        payrollAdjustments: { '2026-07': { keep: false } },
        employees: [{ username: keepEmp, name: '改名员工' }, { username: 'new_emp', name: '新员工' }],
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

  const row = await db.query(`select data from hrms_state where key = $1`, [tenantId]);
  const data = row.rows[0]?.data || {};
  assert.deepEqual(data.roleModules, { admin: ['keep-modules'] });
  assert.equal(data.approvalFlows?.leave?.[0], marker);
  assert.deepEqual(data.paymentFlowByStore, { 测试店: ['keeper'] });

  const keepPr = (Array.isArray(data.pointRecords) ? data.pointRecords : [])
    .find((r) => String(r?.id) === keepPointId);
  assert.ok(keepPr, '应保留 seed 的 pointRecords 条目');
  assert.equal(Number(keepPr.points), 42);
  assert.ok(!(Array.isArray(data.pointRecords) && data.pointRecords.some((r) => Number(r?.points) === -1)),
    'HACKED points=-1 不得写入');

  const prTable = await db.query(
    `select points::float8 as points from point_records where id = $1::uuid`,
    [keepPointId]
  );
  assert.equal(Number(prTable.rows[0]?.points), 42, '权威表 point_records 不得被 PUT 篡改');

  assert.equal(data.payrollAdjustments?.['2026-07']?.keep, true);
  assert.equal(data.settings?.theme, 'new');
  assert.equal(data.totallyNewKey, undefined);
  assert.ok(data.employees.some((e) => e.username === keepEmp && e.name === '保留员工'));
  assert.ok(!data.employees.some((e) => e.username === 'new_emp'));
});
