import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformAdminRequired, requireSuperAdmin, requireSalesManagerOrAbove } from './tenant-platform-routes.js';

test('createPlatformAdminRequired rejects missing token', async () => {
  const mw = createPlatformAdminRequired({ query: async () => ({}) }, 'plat-secret');
  const req = { headers: {}, method: 'GET' };
  const res = {
    statusCode: 0,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  let next = false;
  await mw(req, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(res.statusCode, 401);
});

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('requireSuperAdmin allows super_admin, blocks the other 3 roles with 403', () => {
  let called = false;
  requireSuperAdmin({ platformAdmin: { role: 'super_admin' } }, mockRes(), () => { called = true; });
  assert.equal(called, true);

  for (const role of ['sales_manager', 'sales', 'customer_service', undefined]) {
    called = false;
    const res = mockRes();
    requireSuperAdmin({ platformAdmin: { role } }, res, () => { called = true; });
    assert.equal(called, false, `${role} should be blocked`);
    assert.equal(res.statusCode, 403);
  }
});

test('requireSalesManagerOrAbove allows super_admin and sales_manager, blocks sales/customer_service', () => {
  for (const role of ['super_admin', 'sales_manager']) {
    let called = false;
    requireSalesManagerOrAbove({ platformAdmin: { role } }, mockRes(), () => { called = true; });
    assert.equal(called, true, `${role} should pass`);
  }
  for (const role of ['sales', 'customer_service', undefined]) {
    let called = false;
    const res = mockRes();
    requireSalesManagerOrAbove({ platformAdmin: { role } }, res, () => { called = true; });
    assert.equal(called, false, `${role} should be blocked`);
    assert.equal(res.statusCode, 403);
  }
});
