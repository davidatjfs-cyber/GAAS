import test from 'node:test';
import assert from 'node:assert/strict';
import { setPool } from '../../../utils/database.js';
import {
  invalidatePermissionPolicyCache,
} from '../../../services/hrms-permission-engine.js';
import { tenantOf, requirePayrollPerm } from '../route-helpers.js';

function mockRes() {
  return {
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
}

function makePolicyPool(policyByTenant = { default: 'legacy' }) {
  const queryImpl = async (sql, params) => {
    if (/hrms_permission_policies/.test(String(sql))) {
      const tid = String(params?.[0] || 'default');
      const mode = policyByTenant[tid] || 'legacy';
      return { rows: [{ enforcement_mode: mode }] };
    }
    if (/hrms_permission_grants/.test(String(sql))) {
      return { rows: [] };
    }
    return { rows: [] };
  };
  return {
    query: queryImpl,
    connect: async () => ({
      query: queryImpl,
      release: () => {},
    }),
  };
}

function makeLegacyPool() {
  return makePolicyPool({ default: 'legacy' });
}

test.before(() => {
  setPool(makeLegacyPool());
});

test('tenantOf: req.tenantId / user.tenant_id / default 回落', () => {
  assert.equal(tenantOf({ tenantId: ' t1 ' }), 't1');
  assert.equal(tenantOf({ user: { tenant_id: 't2' } }), 't2');
  assert.equal(tenantOf({ tenantId: '', user: {} }), 'default');
  assert.equal(tenantOf({ tenantId: '   ' }), 'default');
});

test('requirePayrollPerm legacy: payroll.rules 仅 admin/hr/hq', async () => {
  const getSharedState = async () => ({});

  for (const role of ['admin', 'hr_manager', 'hq_manager']) {
    const res = mockRes();
    const ok = await requirePayrollPerm(
      { user: { role }, tenantId: 'default' },
      res,
      'reports.payroll.rules',
      undefined,
      getSharedState
    );
    assert.equal(ok, true, role);
    assert.equal(res.statusCode, 200);
  }

  const denied = mockRes();
  const okDenied = await requirePayrollPerm(
    { user: { role: 'store_manager' }, tenantId: 'default' },
    denied,
    'reports.payroll.rules',
    undefined,
    getSharedState
  );
  assert.equal(okDenied, false);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error, 'forbidden');
});

test('requirePayrollPerm legacy: abnormal_confirm 允许 store_manager', async () => {
  const res = mockRes();
  const ok = await requirePayrollPerm(
    { user: { role: 'store_manager' }, tenantId: 'default' },
    res,
    'reports.payroll.abnormal_confirm',
    undefined,
    async () => ({})
  );
  assert.equal(ok, true);
});

test('requirePayrollPerm legacy: month_run 拒绝 front_manager', async () => {
  const res = mockRes();
  const ok = await requirePayrollPerm(
    { user: { role: 'front_manager' }, tenantId: 'default' },
    res,
    'reports.payroll.month_run',
    undefined,
    async () => ({})
  );
  assert.equal(ok, false);
  assert.equal(res.statusCode, 403);
});

test('requirePayrollPerm legacy: view 允许 store_production_manager', async () => {
  const res = mockRes();
  const ok = await requirePayrollPerm(
    { user: { role: 'store_production_manager' }, tenantId: 'default' },
    res,
    'reports.payroll.view',
    '洪潮店',
    async () => ({})
  );
  assert.equal(ok, true);
});

test('requirePayrollPerm legacy: reconcile 走 rules 权限', async () => {
  const res = mockRes();
  const ok = await requirePayrollPerm(
    { user: { role: 'hq_manager' }, tenantId: 'default' },
    res,
    'reports.payroll.reconcile',
    '洪潮店',
    async () => ({})
  );
  assert.equal(ok, true);
});

test('requirePayrollPerm strict: 无显式授权时拒绝', async () => {
  const tenantId = 'strict_t1';
  invalidatePermissionPolicyCache(tenantId);
  setPool(makePolicyPool({ default: 'legacy', strict_t1: 'strict' }));

  const res = mockRes();
  const ok = await requirePayrollPerm(
    { user: { role: 'admin', username: 'admin1' }, tenantId },
    res,
    'reports.payroll.view',
    undefined,
    async () => ({})
  );
  assert.equal(ok, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.reason, 'permission_denied');

  invalidatePermissionPolicyCache(tenantId);
  setPool(makeLegacyPool());
});
