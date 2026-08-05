import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createCustomerTwinAdminRequired } from '../admin-guard.js';

test('平台管理员 token 放行', async () => {
  const secret = 'plat-secret-test';
  const guard = createCustomerTwinAdminRequired({ platformAdminJwtSecret: secret, hrmsJwtSecret: 'hrms-secret' });
  const token = jwt.sign({ username: 'boss', role: 'platform_admin', account_role: 'super_admin' }, secret);
  const result = await new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    let nextCalled = false;
    const res = { status() { return this; }, json() {} };
    guard(req, res, () => { nextCalled = true; resolve({ nextCalled, req }); });
  });
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.platformAdmin.username, 'boss');
});

test('系统管理员（role=admin）放行', async () => {
  const secret = 'hrms-secret-test';
  const guard = createCustomerTwinAdminRequired({ platformAdminJwtSecret: 'plat', hrmsJwtSecret: secret });
  const token = jwt.sign({ username: 'admin1', role: 'admin', tenant_id: 'default' }, secret);
  const result = await new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    let nextCalled = false;
    const res = { status() { return this; }, json() {} };
    guard(req, res, () => { nextCalled = true; resolve({ nextCalled, req }); });
  });
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.twinAdmin.username, 'admin1');
});

test('非管理员 HRMS token 拒绝', async () => {
  const secret = 'hrms-secret-test';
  const guard = createCustomerTwinAdminRequired({ platformAdminJwtSecret: 'plat', hrmsJwtSecret: secret });
  const token = jwt.sign({ username: 'waiter', role: 'store_employee', tenant_id: 'default' }, secret);
  const result = await new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      status(code) { this.code = code; return this; },
      json(body) { resolve({ code: this.code, body }); },
    };
    guard(req, res, () => resolve({ code: 0 }));
  });
  assert.equal(result.code, 401);
});

test('无 token 拒绝', async () => {
  const guard = createCustomerTwinAdminRequired({ platformAdminJwtSecret: 'plat', hrmsJwtSecret: 'hrms' });
  const result = await new Promise((resolve) => {
    const req = { headers: {} };
    const res = {
      status(code) { this.code = code; return this; },
      json(body) { resolve({ code: this.code, body }); },
    };
    guard(req, res, () => resolve({ code: 0 }));
  });
  assert.equal(result.code, 401);
});
