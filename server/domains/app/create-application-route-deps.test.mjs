import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationRouteDeps } from './create-application-route-deps.js';

const CRITICAL_KEYS = [
  'pool',
  'authRequired',
  'JWT_SECRET',
  'DATABASE_URL',
  'getSharedState',
  'saveSharedState',
  'registerAuthRoutes',
  'registerApprovalRoutes',
  'registerApprovalDecideRoutes',
  'registerPayrollDomainRoutes',
  'registerEmployeesDomainRoutes',
  'registerFeishuWebhookRoutes',
  'registerRemainingStateRoutes',
  'leaveAttendanceHelpers',
  'tenantContext',
  'randomUUID',
  'sendLarkMessage',
];

function buildFakeCtx() {
  const ctx = {};
  for (const key of CRITICAL_KEYS) {
    ctx[key] = () => `${key}:called`;
  }
  // Fill remaining names the factory destructures so no key silently becomes undefined
  // for keys we don't otherwise care about in this test.
  ctx.pool = { query: () => {} };
  ctx.JWT_SECRET = 'test-secret';
  ctx.DATABASE_URL = 'postgres://test';
  ctx.leaveAttendanceHelpers = { calcDateSpanDaysInclusive() {} };
  return ctx;
}

test('createApplicationRouteDeps returns an object exposing all critical keys', () => {
  const ctx = buildFakeCtx();
  const deps = createApplicationRouteDeps(ctx);

  for (const key of CRITICAL_KEYS) {
    assert.ok(key in deps, `expected deps to include "${key}"`);
  }
});

test('createApplicationRouteDeps passes values through unchanged (no transformation)', () => {
  const ctx = buildFakeCtx();
  const deps = createApplicationRouteDeps(ctx);

  assert.equal(deps.pool, ctx.pool);
  assert.equal(deps.JWT_SECRET, ctx.JWT_SECRET);
  assert.equal(deps.DATABASE_URL, ctx.DATABASE_URL);
  assert.equal(deps.getSharedState, ctx.getSharedState);
  assert.equal(deps.registerAuthRoutes, ctx.registerAuthRoutes);
  assert.equal(deps.leaveAttendanceHelpers, ctx.leaveAttendanceHelpers);
});

test('createApplicationRouteDeps omits keys not present on ctx', () => {
  const deps = createApplicationRouteDeps({});
  assert.equal(deps.pool, undefined);
  assert.equal('pool' in deps, true);
});
