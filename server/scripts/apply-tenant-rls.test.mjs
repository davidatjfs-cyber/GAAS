import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMultiTenantModeEnv,
  selectTenantRlsTables,
  buildTenantRlsStatements,
} from './apply-tenant-rls.mjs';

test('apply-tenant-rls: TENANT_MODE 闸门只认 multi/saas/hosted', () => {
  assert.equal(isMultiTenantModeEnv({ TENANT_MODE: 'multi' }), true);
  assert.equal(isMultiTenantModeEnv({ TENANT_MODE: 'saas' }), true);
  assert.equal(isMultiTenantModeEnv({ TENANT_MODE: 'hosted' }), true);
  assert.equal(isMultiTenantModeEnv({ TENANT_MODE: 'single' }), false);
  assert.equal(isMultiTenantModeEnv({}), false);
  assert.equal(isMultiTenantModeEnv({ TENANT_MODE: '' }), false);
});

test('apply-tenant-rls: 只选 public + 有 tenant_id + 不在排除清单的表', () => {
  const rows = [
    { table_schema: 'public', table_name: 'daily_reports', has_tenant_id: true },
    { table_schema: 'public', table_name: 'tenants', has_tenant_id: true },
    { table_schema: 'public', table_name: 'licenses', has_tenant_id: true },
    { table_schema: 'public', table_name: 'agent_v2_configs', has_tenant_id: true },
    { table_schema: 'public', table_name: 'users', has_tenant_id: false },
    { table_schema: 'other', table_name: 'daily_reports', has_tenant_id: true },
    { table_schema: 'public', table_name: 'pos_order_items', has_tenant_id: true },
  ];
  assert.deepEqual(selectTenantRlsTables(rows), ['daily_reports', 'pos_order_items']);
});

test('apply-tenant-rls: 策略语句包含 __system__ 旁路且标识符安全', () => {
  const stmts = buildTenantRlsStatements('daily_reports');
  assert.equal(stmts[0], 'ALTER TABLE "daily_reports" ENABLE ROW LEVEL SECURITY');
  assert.equal(stmts[1], 'ALTER TABLE "daily_reports" FORCE ROW LEVEL SECURITY');
  assert.equal(stmts[3].includes('current_setting(\'app.tenant_id\', true)'), true);
  assert.equal(stmts[3].includes("= '__system__'"), true);
  assert.equal(stmts[3].includes('CREATE POLICY "tenant_isolation"'), true);
});
