import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileTenantRegistryFromState, runForActiveTenants } from './utils/database.js';

test('reconcileTenantRegistryFromState registers persisted tenants without reactivating existing rows', async () => {
  const calls = [];
  const db = {
    async query(sql) {
      calls.push(String(sql));
      return { rows: [{ tenant_id: 'tenant_orphaned' }] };
    },
  };

  const inserted = await reconcileTenantRegistryFromState(db);

  assert.deepEqual(inserted, ['tenant_orphaned']);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /FROM hrms_state/i);
  assert.match(calls[0], /NOT EXISTS[\s\S]*FROM tenants/i);
  assert.match(calls[0], /ON CONFLICT \(tenant_id\) DO NOTHING/i);
  assert.doesNotMatch(calls[0], /DO UPDATE[\s\S]*status/i);
});

test('runForActiveTenants executes each active tenant in its own context', async () => {
  const seen = [];
  const result = await runForActiveTenants(
    async (tenantId) => {
      seen.push(tenantId);
      return `${tenantId}:ok`;
    },
    { getTenantIds: async () => ['default', 'customer_a'] }
  );

  assert.deepEqual(seen, ['default', 'customer_a']);
  assert.deepEqual(result, ['default:ok', 'customer_a:ok']);
});

test('runForActiveTenants refuses to silently run a default tenant when discovery returns none', async () => {
  await assert.rejects(
    () => runForActiveTenants(async () => 'unexpected', { getTenantIds: async () => [] }),
    /no_active_tenants/
  );
});

test('runForActiveTenants can continue after one tenant fails and reports both sides', async () => {
  const seen = [];
  const result = await runForActiveTenants(
    async (tenantId) => {
      seen.push(tenantId);
      if (tenantId === 'customer_a') throw new Error('boom');
      return `${tenantId}:ok`;
    },
    {
      getTenantIds: async () => ['default', 'customer_a', 'customer_b'],
      continueOnError: true,
    }
  );

  assert.deepEqual(seen, ['default', 'customer_a', 'customer_b']);
  assert.deepEqual(result.results, [
    { tenantId: 'default', ok: true, value: 'default:ok' },
    { tenantId: 'customer_b', ok: true, value: 'customer_b:ok' },
  ]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].tenantId, 'customer_a');
  assert.match(result.errors[0].error.message, /boom/);
});
