import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeApprovalFlows,
  normalizePaymentFlowByStore,
  normalizeRoleModules,
  hydrateFlowConfigFromTable,
} from '../domains/flow-config/service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('normalizeApprovalFlows 兼容遗留 array 形状', () => {
  const out = normalizeApprovalFlows({ leave: ['manager', 'admin'], payment: { steps: ['cashier'], stores: ['洪潮'] } });
  assert.deepEqual(out.leave.steps, ['manager', 'admin']);
  assert.deepEqual(out.payment.steps, ['cashier']);
  assert.deepEqual(out.payment.stores, ['洪潮']);
});

test('normalizePaymentFlowByStore 兼容遗留 array 形状', () => {
  const out = normalizePaymentFlowByStore({ 洪潮: ['u1', 'u2'], 马己仙: { approvers: ['a'], cashier: 'c1' } });
  assert.deepEqual(out['洪潮'].approvers, ['u1', 'u2']);
  assert.equal(out['马己仙'].cashier, 'c1');
});

test('normalizeRoleModules 自动补 training', () => {
  const out = normalizeRoleModules({ store_manager: ['employees', 'attendance'] });
  assert.ok(out.store_manager.includes('training'));
});

test('影子 API 已拆除：agent-config-manager 不再注册 role-modules', () => {
  const src = readFileSync(join(__dirname, '../agent-config-manager.js'), 'utf8');
  assert.equal(src.includes("app.get('/api/role-modules'"), false);
  assert.equal(src.includes("app.put('/api/admin/role-modules'"), false);
  assert.ok(src.includes('domains/flow-config'));
});

test('hydrateFlowConfigFromTable：表有数据时覆盖', async () => {
  const pool = {
    async query(_sql, params) {
      const key = params?.[0];
      if (key === 'role_module_config') return { rows: [{ config: { hq_manager: ['reports'] } }] };
      if (key === 'approval_flows') return { rows: [{ config: { leave: { steps: ['admin'] } } }] };
      if (key === 'payment_flow_by_store') return { rows: [{ config: { 洪潮: { approvers: ['x'] } } }] };
      return { rows: [] };
    },
  };
  const out = await hydrateFlowConfigFromTable(
    pool,
    { roleModules: { stale: ['a'] }, approvalFlows: {}, paymentFlowByStore: {}, settings: { ok: 1 } },
    'default'
  );
  assert.equal(out.settings.ok, 1);
  assert.ok(out.roleModules.hq_manager.includes('training'));
  assert.deepEqual(out.approvalFlows.leave.steps, ['admin']);
  assert.deepEqual(out.paymentFlowByStore['洪潮'].approvers, ['x']);
});
