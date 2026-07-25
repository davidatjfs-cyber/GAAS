import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyTenantState, resolveExplicitTenantId } from './tenant-login.js';

test('login without an explicit tenant returns null (caller resolves by username)', () => {
  assert.equal(resolveExplicitTenantId({ body: {}, headers: {} }), null);
});

test('login accepts an explicit normalized tenant id', () => {
  assert.equal(
    resolveExplicitTenantId({ body: { tenant_id: '  demo-company  ' }, headers: {} }),
    'demo-company'
  );
});

test('login accepts x-tenant-id header', () => {
  assert.equal(
    resolveExplicitTenantId({ body: {}, headers: { 'x-tenant-id': 'brand-a' } }),
    'brand-a'
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

test('createEmptyTenantState seeds admin employee when username given', () => {
  const state = createEmptyTenantState({
    tenantId: 't1',
    tenantName: 'Demo',
    adminUsername: 'boss',
    adminName: '老板',
  });
  assert.equal(state.tenant.tenantId, 't1');
  assert.equal(state.tenant.name, 'Demo');
  assert.equal(state.employees.length, 1);
  assert.equal(state.employees[0].username, 'boss');
  assert.equal(state.employees[0].role, 'admin');
  assert.deepEqual(state.users, []);
  assert.deepEqual(state.stores, []);
});

test('createEmptyTenantState without admin leaves employees empty', () => {
  const state = createEmptyTenantState({ tenantId: 't2', tenantName: 'Empty' });
  assert.deepEqual(state.employees, []);
});
