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

test('A2 流程配置：窄 API 写表 + GET hydrate；PUT /api/state 不能覆盖', async () => {
  const db = testDb();
  const admin = await createAdmin();
  const token = await login(admin);
  const marker = uniqueId('flow');

  const putFlows = await fetch(app.baseUrl + '/api/approval-flows', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      approvalFlows: { leave: { steps: ['manager', 'admin'] } },
      paymentFlowByStore: { 测试店: { approvers: ['u1'], cashier: 'c1' } },
    }),
  });
  const putFlowsBody = await putFlows.json();
  assert.equal(putFlows.status, 200, JSON.stringify(putFlowsBody));

  const putRoles = await fetch(app.baseUrl + '/api/role-modules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ config: { store_manager: ['employees', 'attendance'] } }),
  });
  assert.equal(putRoles.status, 200, await putRoles.text());

  const table = await db.query(
    `select config_key from hr_rating_configs
      where tenant_id='default' and config_key = any($1::text[])`,
    [['approval_flows', 'payment_flow_by_store', 'role_module_config']]
  );
  const keys = new Set(table.rows.map((r) => r.config_key));
  assert.ok(keys.has('approval_flows'));
  assert.ok(keys.has('payment_flow_by_store'));
  assert.ok(keys.has('role_module_config'));

  const spoof = await fetch(app.baseUrl + '/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      data: {
        approvalFlows: { leave: { steps: [marker] } },
        roleModules: { store_manager: ['HACKED'] },
        paymentFlowByStore: { 测试店: { approvers: ['HACKED'] } },
        pointRules: [{ id: 'hack' }],
        settings: { theme: 'flow-a2' },
      },
    }),
  });
  const spoofBody = await spoof.json();
  assert.equal(spoof.status, 200, JSON.stringify(spoofBody));
  assert.ok(spoofBody.ignoredKeys?.includes('approvalFlows'));
  assert.ok(spoofBody.ignoredKeys?.includes('roleModules'));
  assert.ok(spoofBody.ignoredKeys?.includes('pointRules'));

  const getState = await fetch(app.baseUrl + '/api/state', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const stateBody = await getState.json();
  assert.equal(getState.status, 200);
  assert.deepEqual(stateBody.data?.approvalFlows?.leave?.steps, ['manager', 'admin']);
  assert.ok(stateBody.data?.roleModules?.store_manager?.includes('employees'));
  assert.ok(!String(stateBody.data?.roleModules?.store_manager || []).includes('HACKED'));
  assert.equal(stateBody.data?.settings?.theme, 'flow-a2');

  const getFlows = await fetch(app.baseUrl + '/api/approval-flows', {
    headers: { Authorization: 'Bearer ' + token },
  });
  const flowsBody = await getFlows.json();
  assert.equal(getFlows.status, 200, JSON.stringify(flowsBody));
  assert.equal(flowsBody.paymentFlowByStore?.['测试店']?.cashier, 'c1');
});
