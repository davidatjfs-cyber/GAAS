/**
 * L1：平台鉴权守卫 — 401/403/角色门槛/审计写路径。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  createPlatformAdminRequired,
  requireSalesManagerOrAbove,
  requireSuperAdmin,
} from '../auth-guards.js';

const SECRET = 'test-platform-admin-secret';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function mockReq(overrides = {}) {
  return {
    headers: {},
    method: 'GET',
    path: '/api/admin/foo',
    originalUrl: '/api/admin/foo',
    params: {},
    body: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

test('requireSuperAdmin: 非超管 403', () => {
  const res = mockRes();
  let nextCalled = false;
  requireSuperAdmin(mockReq({ platformAdmin: { role: 'sales_manager' } }), res, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requireSuperAdmin: 超管放行', () => {
  const res = mockRes();
  let nextCalled = false;
  requireSuperAdmin(mockReq({ platformAdmin: { role: 'super_admin' } }), res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('requireSalesManagerOrAbove: sales 403；sales_manager 放行', () => {
  const res = mockRes();
  requireSalesManagerOrAbove(mockReq({ platformAdmin: { role: 'sales' } }), res, () => {
    assert.fail('should not next');
  });
  assert.equal(res.statusCode, 403);

  let ok = false;
  requireSalesManagerOrAbove(mockReq({ platformAdmin: { role: 'sales_manager' } }), mockRes(), () => {
    ok = true;
  });
  assert.equal(ok, true);
});

test('platformAdminRequired: 无 token → 401', async () => {
  const mw = createPlatformAdminRequired({ query: async () => ({ rows: [] }) }, SECRET);
  const res = mockRes();
  await mw(mockReq(), res, () => assert.fail('should not next'));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, 'unauthorized');
});

test('platformAdminRequired: 坏 token → 401', async () => {
  const mw = createPlatformAdminRequired({ query: async () => ({ rows: [] }) }, SECRET);
  const res = mockRes();
  await mw(mockReq({ headers: { authorization: 'Bearer not-a-jwt' } }), res, () => assert.fail('no'));
  assert.equal(res.statusCode, 401);
});

test('platformAdminRequired: 过期 JWT → 401', async () => {
  const mw = createPlatformAdminRequired({ query: async () => ({ rows: [] }) }, SECRET);
  const token = jwt.sign(
    { role: 'platform_admin', username: 'root', account_role: 'super_admin' },
    SECRET,
    { expiresIn: '-10s' }
  );
  const res = mockRes();
  await mw(mockReq({ headers: { authorization: `Bearer ${token}` } }), res, () => assert.fail('no'));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.error, 'unauthorized');
});

test('platformAdminRequired: role 不是 platform_admin → 401', async () => {
  const mw = createPlatformAdminRequired({ query: async () => ({ rows: [] }) }, SECRET);
  const token = jwt.sign({ role: 'user', username: 'x' }, SECRET);
  const res = mockRes();
  await mw(mockReq({ headers: { authorization: `Bearer ${token}` } }), res, () => assert.fail('no'));
  assert.equal(res.statusCode, 401);
});

test('platformAdminRequired: 非超管访问租户总控 → 403', async () => {
  const mw = createPlatformAdminRequired({ query: async () => ({ rows: [] }) }, SECRET);
  const token = jwt.sign({
    role: 'platform_admin',
    username: 'ops',
    account_role: 'sales_manager',
  }, SECRET);
  const res = mockRes();
  await mw(mockReq({
    headers: { authorization: `Bearer ${token}` },
    path: '/api/admin/tenants',
    originalUrl: '/api/admin/tenants',
  }), res, () => assert.fail('no'));
  assert.equal(res.statusCode, 403);
});

test('platformAdminRequired: auditor 非 GET → 403', async () => {
  const mw = createPlatformAdminRequired({ query: async () => ({ rows: [] }) }, SECRET);
  const token = jwt.sign({
    role: 'platform_admin',
    username: 'audit1',
    account_role: 'auditor',
  }, SECRET);
  const res = mockRes();
  await mw(mockReq({
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
    path: '/api/admin/leads',
    originalUrl: '/api/admin/leads',
    body: { name: 'x' },
  }), res, () => assert.fail('no'));
  assert.equal(res.statusCode, 403);
  assert.ok(String(res.body?.message || '').includes('只读'));
});

test('platformAdminRequired: 合法超管 GET 放行；POST 写审计并脱敏', async () => {
  const auditCalls = [];
  const pool = {
    async query(sql, params) {
      auditCalls.push({ sql: String(sql), params });
      return { rows: [] };
    },
  };
  const mw = createPlatformAdminRequired(pool, SECRET);
  const token = jwt.sign({
    role: 'platform_admin',
    username: 'root',
    account_role: 'super_admin',
  }, SECRET);

  let nextN = 0;
  await mw(mockReq({
    headers: { authorization: `Bearer ${token}` },
    method: 'GET',
    path: '/api/admin/health-center',
    originalUrl: '/api/admin/health-center',
  }), mockRes(), () => {
    nextN += 1;
  });
  assert.equal(nextN, 1);
  assert.equal(auditCalls.length, 0);

  await mw(mockReq({
    headers: { authorization: `Bearer ${token}` },
    method: 'POST',
    path: '/api/admin/tenants',
    originalUrl: '/api/admin/tenants',
    params: { tenantId: 't1' },
    body: { tenant_id: 't1', api_secret: 'should-mask', name: 'ok' },
  }), mockRes(), () => {
    nextN += 1;
  });
  assert.equal(nextN, 2);
  assert.equal(auditCalls.length, 1);
  const detail = JSON.parse(auditCalls[0].params[4]);
  assert.equal(detail.api_secret, '***');
  assert.equal(detail.name, 'ok');
});
