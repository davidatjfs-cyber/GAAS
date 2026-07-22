import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { bootApp } from './helpers/boot-app.mjs';
import { testDb, uniqueId, ensureDefaultTenant } from './helpers/db.mjs';

// P0覆盖：agents.js 核心的 issue 管理路由（/api/agents/issues 及 resolve），
// 这是agents.js里少数纯DB读写、不依赖飞书/AI外部调用的路由，适合作为拆分前
// 的第一批覆盖对象。同时验证了角色级别的行数据过滤（store_manager 只能看到
// 分配给自己的issue）+ 租户过滤，这两个过滤条件都在同一段SQL里拼接，
// 拆分时最容易被误改丢失。

let app;

async function createUser(role, tenantId = 'default') {
  const db = testDb();
  const username = uniqueId('u');
  const hash = await bcrypt.hash('Pass12345', 10);
  await db.query(
    `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
     values ($1, $2, '测试', $3, true, $4)`,
    [username, hash, role, tenantId]
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

async function createIssue({ tenantId = 'default', assignee = null, status = 'open', title }) {
  const db = testDb();
  const r = await db.query(
    `insert into agent_issues (tenant_id, agent, severity, title, status, assignee_username)
     values ($1, 'test-agent', 'high', $2, $3, $4) returning id`,
    [tenantId, title, status, assignee]
  );
  return r.rows[0].id;
}

test.before(async () => {
  await ensureDefaultTenant();
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

test('admin能看到所有issue，store_manager只能看到分配给自己的', async () => {
  const admin = await createUser('admin');
  const managerA = await createUser('store_manager');
  const managerB = await createUser('store_manager');

  await createIssue({ title: '分配给A的问题', assignee: managerA });
  await createIssue({ title: '分配给B的问题', assignee: managerB });
  await createIssue({ title: '没人认领的问题', assignee: null });

  const adminToken = await login(admin);
  const adminRes = await fetch(app.baseUrl + '/api/agents/issues', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  const adminBody = await adminRes.json();
  assert.equal(adminRes.status, 200, JSON.stringify(adminBody));
  const adminTitles = adminBody.items.map((i) => i.title);
  assert.ok(adminTitles.includes('分配给A的问题'));
  assert.ok(adminTitles.includes('分配给B的问题'));
  assert.ok(adminTitles.includes('没人认领的问题'), 'admin应该能看到所有issue，包括没人认领的');

  const managerAToken = await login(managerA);
  const managerARes = await fetch(app.baseUrl + '/api/agents/issues', {
    headers: { Authorization: 'Bearer ' + managerAToken }
  });
  const managerABody = await managerARes.json();
  assert.equal(managerARes.status, 200, JSON.stringify(managerABody));
  const managerATitles = managerABody.items.map((i) => i.title);
  assert.ok(managerATitles.includes('分配给A的问题'), 'manager A应该能看到自己的issue');
  assert.ok(!managerATitles.includes('分配给B的问题'), 'manager A不应该看到分配给B的issue');
  assert.ok(!managerATitles.includes('没人认领的问题'), 'manager A不应该看到没人认领的issue');
});

test('status过滤：只查open状态', async () => {
  const admin = await createUser('admin');
  await createIssue({ title: '待处理问题', status: 'open' });
  await createIssue({ title: '已解决问题', status: 'resolved' });

  const token = await login(admin);
  const res = await fetch(app.baseUrl + '/api/agents/issues?status=open', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const titles = body.items.map((i) => i.title);
  assert.ok(titles.includes('待处理问题'));
  assert.ok(!titles.includes('已解决问题'));
});

test('resolve接口：标记issue为resolved并记录处理说明', async () => {
  const admin = await createUser('admin');
  const issueId = await createIssue({ title: '待resolve的问题', status: 'open' });

  const token = await login(admin);
  const res = await fetch(app.baseUrl + `/api/agents/issues/${issueId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ resolution: '已联系门店确认处理完毕' })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));

  const db = testDb();
  const row = await db.query(`select status, resolution, resolved_at from agent_issues where id = $1`, [issueId]);
  assert.equal(row.rows[0].status, 'resolved');
  assert.equal(row.rows[0].resolution, '已联系门店确认处理完毕');
  assert.ok(row.rows[0].resolved_at, '应该记录处理时间');
});

test('resolve接口：跨租户不能改动别的租户的issue', async () => {
  const db = testDb();
  const otherTenant = uniqueId('other_tenant');
  await db.query(
    `insert into tenants (tenant_id, name, status) values ($1, '其他租户', 'active')`,
    [otherTenant]
  );
  const otherIssueId = await createIssue({ tenantId: otherTenant, title: '别的租户的问题', status: 'open' });

  const admin = await createUser('admin'); // 属于default租户
  const token = await login(admin);

  const res = await fetch(app.baseUrl + `/api/agents/issues/${otherIssueId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ resolution: '尝试跨租户篡改' })
  });
  assert.equal(res.status, 200); // 接口本身不报错(UPDATE影响0行也返回ok)，但实际不应该生效

  const row = await db.query(`select status from agent_issues where id = $1`, [otherIssueId]);
  assert.equal(row.rows[0].status, 'open', '别的租户的issue不应该被改动');
});
