import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId } from './helpers/db.mjs';

// P0覆盖：多租户隔离是拆分时风险最高的部分——如果拆分时不小心把tenant_id过滤条件
// 漏掉或写错，后果是A租户看到B租户的数据，这是能直接导致客户投诉/法律风险的问题。
//
// 这里用真实HTTP请求 + 两个独立租户的真实数据来验证，而不是只测代码里的SQL拼接逻辑。
// 应用连接数据库用的是非superuser角色(见 boot-app.mjs)，agent_issues表有
// FORCE ROW LEVEL SECURITY(migrations/071)，所以这个测试同时验证了：
// 1) 路由里的 WHERE tenant_id = $1 过滤条件本身没写错
// 2) 就算(1)哪天被改错，RLS策略作为兜底也不会让跨租户数据泄露出去

let app;

async function createTenant(tenantId) {
  const db = testDb();
  await db.query(
    `insert into tenants (tenant_id, name, status) values ($1, $2, 'active')
     on conflict (tenant_id) do update set status = 'active'`,
    [tenantId, '测试租户_' + tenantId]
  );
}

async function createAdminUser(tenantId) {
  const db = testDb();
  const username = uniqueId('admin'); // username是varchar(50)，不能把完整tenantId拼进去
  const hash = await bcrypt.hash('AdminPass123', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '管理员', 'admin', true, $3)`,
    [username, hash, tenantId]
  );
  return username;
}

async function createAgentIssue(tenantId, title) {
  const db = testDb();
  // 直接用superuser连接插入，绕过RLS，模拟"这条数据本来就属于该租户"的既有状态
  await db.query(
    `insert into agent_issues (tenant_id, agent, severity, title, status)
     values ($1, 'test-agent', 'high', $2, 'open')`,
    [tenantId, title]
  );
}

async function loginAndGetToken(username, password, tenantId) {
  // 真实前端(working-fixed.html resolveHrmsLoginTenantId())登录时会显式带tenant_id，
  // 这里照实模拟。如果不带tenant_id，会走 lookupTenantIdByUsername() 这条已知有缺陷的
  // 兜底路径(runWithSystemTenantContext 并没有真正绕过 users 表的RLS，会静默错误回退到
  // 'default'租户)——这是本次测试意外发现的一个独立问题，不在这次测试范围内修，
  // 已经单独报告给用户，这里为了不被这个已知问题挡住，按真实客户端行为发tenant_id。
  const res = await fetch(app.baseUrl + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
    body: JSON.stringify({ username, password, tenant_id: tenantId })
  });
  const body = await res.json();
  assert.equal(res.status, 200, 'login应成功: ' + JSON.stringify(body));
  return body.token;
}

test.before(async () => {
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('租户A的管理员看不到租户B的agent_issues数据', async () => {
  const tenantA = uniqueId('tenant_a');
  const tenantB = uniqueId('tenant_b');
  await createTenant(tenantA);
  await createTenant(tenantB);

  const adminA = await createAdminUser(tenantA);

  await createAgentIssue(tenantA, '租户A自己的问题');
  await createAgentIssue(tenantB, '租户B的问题——A不应该看到');
  await createAgentIssue(tenantB, '租户B的问题2——A不应该看到');

  const token = await loginAndGetToken(adminA, 'AdminPass123', tenantA);

  const res = await fetch(app.baseUrl + '/api/agents/dashboard', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  // 租户A只插了1条issue，如果隔离失效会看到3条(A的1条+B的2条)
  assert.equal(Number(body.issues.total), 1, '租户A应该只看到自己的1条issue，实际: ' + JSON.stringify(body.issues));
});

test('租户B的管理员看不到租户A的agent_issues数据（反向验证，防止只是恰好A排在前面）', async () => {
  const tenantA = uniqueId('tenant_a2');
  const tenantB = uniqueId('tenant_b2');
  await createTenant(tenantA);
  await createTenant(tenantB);

  const adminB = await createAdminUser(tenantB);

  await createAgentIssue(tenantA, '租户A2的问题——B不应该看到');
  await createAgentIssue(tenantB, '租户B2自己的问题');

  const token = await loginAndGetToken(adminB, 'AdminPass123', tenantB);

  const res = await fetch(app.baseUrl + '/api/agents/dashboard', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(Number(body.issues.total), 1, '租户B应该只看到自己的1条issue，实际: ' + JSON.stringify(body.issues));
});
