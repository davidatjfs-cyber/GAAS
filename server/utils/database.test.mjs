import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tenantContext,
  resolveTenantIdDefault,
  resolveTenantIdStrict,
  runWithSystemTenantContext,
  runWithBootstrapTenantContext,
  setPool,
  pool,
  getActiveTenantIds,
  runForActiveTenants,
  safeQuery,
  safeTransaction,
} from './database.js';

test('resolveTenantIdDefault uses explicit value, ALS store, then default', () => {
  assert.equal(resolveTenantIdDefault('tenant_a'), 'tenant_a');
  tenantContext.run('tenant_ctx', () => {
    assert.equal(resolveTenantIdDefault(), 'tenant_ctx');
  });
  assert.equal(resolveTenantIdDefault(undefined), 'default');
});

test('resolveTenantIdStrict returns sentinel when tenant missing', () => {
  assert.equal(resolveTenantIdStrict('tenant_b'), 'tenant_b');
  assert.match(resolveTenantIdStrict(), /^__rls_no_tenant_context__$/);
});

test('runWithSystemTenantContext and runWithBootstrapTenantContext set ALS', async () => {
  await runWithSystemTenantContext(() => {
    assert.equal(tenantContext.getStore(), '__system__');
  });
  await runWithBootstrapTenantContext(() => {
    assert.equal(tenantContext.getStore(), 'default');
  });
  await runWithBootstrapTenantContext(() => {
    assert.equal(tenantContext.getStore(), 'tenant_x');
  }, 'tenant_x');
});

test('setPool/pool and safeQuery/safeTransaction work with fake pool', async () => {
  const calls = [];
  const fakeClient = {
    query: async (sql) => {
      calls.push(sql);
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'COMMIT') return { rows: [] };
      if (sql === 'ROLLBACK') return { rows: [] };
      if (String(sql).includes('set_config')) return { rows: [] };
      return { rows: [{ ok: true }] };
    },
    release: () => {},
  };
  const fakePool = {
    connect: async () => fakeClient,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ ok: true }] };
    },
  };
  setPool(fakePool);
  const r = await safeQuery('SELECT 1');
  assert.deepEqual(r.rows, [{ ok: true }]);
  const tx = await safeTransaction(async (client) => {
    const inner = await client.query('SELECT 2');
    return inner.rows[0];
  });
  assert.deepEqual(tx, { ok: true });
  assert.ok(calls.some((c) => c === 'BEGIN' || c?.sql === 'BEGIN'));
  assert.equal(pool(), fakePool);
});

test('getActiveTenantIds caches active tenants from pool', async () => {
  const fakePool = {
    query: async (sql) => {
      if (/INSERT INTO tenants/i.test(sql)) return { rows: [] };
      if (/SELECT tenant_id FROM tenants/i.test(sql)) {
        return { rows: [{ tenant_id: 'default' }, { tenant_id: 'tenant_2' }] };
      }
      return { rows: [] };
    },
  };
  const ids = await getActiveTenantIds(fakePool);
  assert.deepEqual(ids, ['default', 'tenant_2']);
  const cached = await getActiveTenantIds(fakePool);
  assert.deepEqual(cached, ids);
});

test('runForActiveTenants executes work per tenant', async () => {
  const seen = [];
  const results = await runForActiveTenants(
    async (tenantId) => {
      seen.push(tenantId);
      return tenantId;
    },
    { getTenantIds: async () => ['a', 'b'] }
  );
  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual(results, ['a', 'b']);
});

test('runForActiveTenants throws when no active tenants', async () => {
  await assert.rejects(
    () => runForActiveTenants(async () => {}, { getTenantIds: async () => [] }),
    /no_active_tenants/
  );
});
