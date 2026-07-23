import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExplicitTenantId } from './tenant-login.js';

test('login without an explicit tenant returns null (caller resolves by username)', () => {
  assert.equal(resolveExplicitTenantId({ body: {}, headers: {} }), null);
});

test('login accepts an explicit normalized tenant id', () => {
  assert.equal(
    resolveExplicitTenantId({ body: { tenant_id: '  demo-company  ' }, headers: {} }),
    'demo-company'
  );
});

test('login rejects malformed tenant ids before querying identity tables', () => {
  assert.throws(
    () => resolveExplicitTenantId({ body: { tenant_id: 'wrong tenant/id' }, headers: {} }),
    /invalid_tenant_id/
  );
});

test('login rejects reserved __system__ tenant id from client', () => {
  assert.throws(
    () => resolveExplicitTenantId({ body: { tenant_id: '__system__' }, headers: {} }),
    /invalid_tenant_id/
  );
});
