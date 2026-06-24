import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveLoginTenantId } from './tenant-login.js';

test('legacy login without a tenant remains in default tenant', () => {
  assert.equal(resolveLoginTenantId({ body: {}, headers: {} }), 'default');
});

test('login accepts an explicit normalized tenant id', () => {
  assert.equal(
    resolveLoginTenantId({ body: { tenant_id: '  demo-company  ' }, headers: {} }),
    'demo-company'
  );
});

test('login rejects malformed tenant ids before querying identity tables', () => {
  assert.throws(
    () => resolveLoginTenantId({ body: { tenant_id: 'wrong tenant/id' }, headers: {} }),
    /invalid_tenant_id/
  );
});
