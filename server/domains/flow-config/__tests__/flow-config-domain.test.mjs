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
  loadConfigByKey,
  upsertConfigByKey,
  loadFlowConfigBundle,
  saveRoleModules,
  saveApprovalFlows,
  savePaymentFlowByStore,
} from '../service.js';

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
  const src = readFileSync(join(__dirname, '../../../agent-config-manager.js'), 'utf8');
  const rulesSrc = readFileSync(join(__dirname, '../../agent-config/routes-rules.js'), 'utf8');
  assert.equal(src.includes("app.get('/api/role-modules'"), false);
  assert.equal(src.includes("app.put('/api/admin/role-modules'"), false);
  assert.equal(rulesSrc.includes("app.get('/api/role-modules'"), false);
  assert.equal(rulesSrc.includes("app.put('/api/admin/role-modules'"), false);
  assert.ok(rulesSrc.includes('domains/flow-config'));
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

test('loadConfigByKey：空 key / JSON 字符串 / 坏 JSON', async () => {
  assert.equal(await loadConfigByKey({ query: async () => ({ rows: [] }) }, 't', ''), null);
  const ok = await loadConfigByKey(
    {
      query: async () => ({ rows: [{ config: '{"a":1}' }] }),
    },
    't',
    'k'
  );
  assert.deepEqual(ok, { a: 1 });
  const bad = await loadConfigByKey(
    {
      query: async () => ({ rows: [{ config: '{not-json' }] }),
    },
    't',
    'k'
  );
  assert.equal(bad, null);
});

test('upsertConfigByKey / save* / loadFlowConfigBundle', async () => {
  const writes = [];
  const pool = {
    async query(sql, params) {
      if (/INSERT INTO/i.test(String(sql))) {
        writes.push(params);
        return { rows: [] };
      }
      const key = params?.[0];
      if (key === 'role_module_config') return { rows: [{ config: { store_manager: ['employees'] } }] };
      return { rows: [] };
    },
  };
  await assert.rejects(() => upsertConfigByKey(pool, 't', '', {}), /missing_config_key/);
  const payload = await upsertConfigByKey(pool, 't', 'custom_key', { x: 1 });
  assert.deepEqual(payload, { x: 1 });

  const rm = await saveRoleModules(pool, 't', { store_manager: ['employees'] });
  assert.ok(rm.store_manager.includes('training'));
  const af = await saveApprovalFlows(pool, 't', { leave: ['admin'] });
  assert.deepEqual(af.leave.steps, ['admin']);
  const pf = await savePaymentFlowByStore(pool, 't', { 洪潮: ['u1'] });
  assert.deepEqual(pf['洪潮'].approvers, ['u1']);
  assert.ok(writes.length >= 4);

  const bundle = await loadFlowConfigBundle(pool, 't');
  assert.ok(bundle.roleModules.store_manager.includes('training'));
  assert.equal(bundle.approvalFlows, null);
});

test('hydrateFlowConfigFromTable：pool 失败保留原 state', async () => {
  const out = await hydrateFlowConfigFromTable(
    {
      query: async () => {
        throw new Error('db_down');
      },
    },
    { roleModules: { keep: ['a'] }, settings: { ok: 1 } },
    'default'
  );
  assert.deepEqual(out.roleModules, { keep: ['a'] });
  assert.equal(out.settings.ok, 1);
});
