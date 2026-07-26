import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoreAccessContextHelpers } from '../store-access-context.js';

function makeHelpers(overrides = {}) {
  const calls = { load: 0, ensure: 0, buildArgs: [] };
  const helpers = createStoreAccessContextHelpers({
    pool: {},
    getSharedState: async () => ({}),
    resolveTenantIdDefault: () => 'default',
    normalizeRoleForJwt: (r) => String(r || '').trim() || 'store_employee',
    resolveStoreScopeStores: () => null,
    ensureStoreDutyBindingsReady: async () => {
      calls.ensure += 1;
    },
    loadActiveDutyRowsForUser: async () => {
      calls.load += 1;
      return [];
    },
    buildStoreAccessContext: (args) => {
      calls.buildArgs.push(args);
      return {
        role: args.role,
        stateStore: args.stateStore,
        dutyRows: args.dutyRows,
        requestedStore: args.requestedStore,
        primaryStore: args.stateStore || '',
        currentStore: args.requestedStore || args.stateStore || '',
        allowedStores: (args.dutyRows || []).map((r) => r.store).filter(Boolean),
      };
    },
    ...overrides,
  });
  return { ...helpers, calls };
}

test('empty username still returns buildStoreAccessContext with empty dutyRows', async () => {
  const { getUserStoreAccessContext, calls } = makeHelpers({
    loadActiveDutyRowsForUser: async () => {
      calls.load += 1;
      return [{ store: 'should-not-load' }];
    },
  });

  const ctx = await getUserStoreAccessContext('', 'store_manager', { stateStore: '店A' });
  assert.equal(calls.load, 0);
  assert.equal(calls.ensure, 0);
  assert.deepEqual(calls.buildArgs[0].dutyRows, []);
  assert.equal(ctx.role, 'store_manager');
  assert.equal(calls.buildArgs[0].stateStore, '店A');
});

test('permission group storeScope (stores/all) → synthetic dutyRows, no loadActiveDutyRowsForUser', async () => {
  const { getUserStoreAccessContext, calls } = makeHelpers({
    getSharedState: async () => ({
      employees: [{ username: 'alice', permissionGroupId: 'g1' }],
      permissionGroups: [{
        id: 'g1',
        storeScope: { mode: 'stores', stores: ['马己仙', '洪潮'] },
        actions: { can_approve_hrms: true, can_view_employees: false },
      }],
    }),
    resolveStoreScopeStores: (_state, scope) => {
      assert.equal(scope.mode, 'stores');
      return ['马己仙', '洪潮'];
    },
  });

  const ctx = await getUserStoreAccessContext('alice', 'store_manager', { stateStore: '洪潮' });
  assert.equal(calls.load, 0);
  assert.equal(calls.ensure, 0);
  assert.deepEqual(ctx.dutyRows, [
    {
      username: 'alice',
      store: '马己仙',
      access_level: 'support',
      is_primary_store: false,
      can_approve_hrms: true,
      can_view_employees: false,
    },
    {
      username: 'alice',
      store: '洪潮',
      access_level: 'primary',
      is_primary_store: true,
      can_approve_hrms: true,
      can_view_employees: false,
    },
  ]);

  // mode all also synthetic
  const helpers2 = makeHelpers({
    getSharedState: async () => ({
      employees: [{ username: 'bob', permissionGroupId: 'g2' }],
      permissionGroups: [{
        id: 'g2',
        storeScope: { mode: 'all' },
        actions: { can_view_employees: true },
      }],
    }),
    resolveStoreScopeStores: () => ['店A', '店B'],
  });
  const ctx2 = await helpers2.getUserStoreAccessContext('bob', 'hq_employee', {});
  assert.equal(helpers2.calls.load, 0);
  assert.equal(ctx2.dutyRows[0].is_primary_store, true);
  assert.equal(ctx2.dutyRows[0].store, '店A');
  assert.equal(ctx2.dutyRows[0].can_view_employees, true);
  assert.equal(ctx2.dutyRows[0].can_approve_hrms, false);
});

test('storeScopeOverride beats group.storeScope', async () => {
  let seenScope = null;
  const { getUserStoreAccessContext, calls } = makeHelpers({
    getSharedState: async () => ({
      employees: [{
        username: 'carol',
        permissionGroupId: 'g1',
        storeScopeOverride: { mode: 'stores', stores: ['Override店'] },
      }],
      permissionGroups: [{
        id: 'g1',
        storeScope: { mode: 'all' },
        actions: { can_approve_hrms: true },
      }],
    }),
    resolveStoreScopeStores: (_state, scope) => {
      seenScope = scope;
      return ['Override店'];
    },
  });

  await getUserStoreAccessContext('carol', 'store_manager', {});
  assert.deepEqual(seenScope, { mode: 'stores', stores: ['Override店'] });
  assert.equal(calls.load, 0);
  assert.equal(calls.buildArgs[0].dutyRows[0].store, 'Override店');
  assert.equal(calls.buildArgs[0].dutyRows[0].can_approve_hrms, true);
});

test('resolveStoreScopeStores null → loads duty rows; OR-merges scopeActions', async () => {
  const { getUserStoreAccessContext, calls } = makeHelpers({
    getSharedState: async () => ({
      employees: [{ username: 'dave', permissionGroupId: 'g1' }],
      permissionGroups: [{
        id: 'g1',
        // no storeScope → resolve returns null
        actions: { can_approve_hrms: true, can_view_employees: true },
      }],
    }),
    resolveStoreScopeStores: () => null,
    loadActiveDutyRowsForUser: async (_pool, username) => {
      calls.load += 1;
      assert.equal(username, 'dave');
      return [
        { store: '马己仙', can_approve_hrms: false, can_view_employees: false },
        { store: '洪潮', can_approve_hrms: true, can_view_employees: false },
      ];
    },
  });

  const ctx = await getUserStoreAccessContext('dave', 'store_manager', { stateStore: '马己仙' });
  assert.equal(calls.ensure, 1);
  assert.equal(calls.load, 1);
  assert.deepEqual(ctx.dutyRows, [
    { store: '马己仙', can_approve_hrms: true, can_view_employees: true },
    { store: '洪潮', can_approve_hrms: true, can_view_employees: true },
  ]);
});

test('getSharedState throw → falls back to duty load path (scopeStores null)', async () => {
  const { getUserStoreAccessContext, calls } = makeHelpers({
    getSharedState: async () => {
      throw new Error('state_down');
    },
    loadActiveDutyRowsForUser: async () => {
      calls.load += 1;
      return [{ store: '店A', can_approve_hrms: false, can_view_employees: false }];
    },
  });

  const ctx = await getUserStoreAccessContext('erin', 'store_manager', {});
  assert.equal(calls.load, 1);
  assert.equal(calls.ensure, 1);
  assert.deepEqual(ctx.dutyRows, [
    { store: '店A', can_approve_hrms: false, can_view_employees: false },
  ]);
});

test('ensure/load throw → dutyRows []', async () => {
  const { getUserStoreAccessContext, calls } = makeHelpers({
    getSharedState: async () => ({
      employees: [{ username: 'frank', permissionGroupId: 'g1' }],
      permissionGroups: [{ id: 'g1', actions: { can_approve_hrms: true } }],
    }),
    resolveStoreScopeStores: () => null,
    ensureStoreDutyBindingsReady: async () => {
      calls.ensure += 1;
      throw new Error('ensure_fail');
    },
  });

  const ctx = await getUserStoreAccessContext('frank', 'store_manager', {});
  assert.equal(calls.ensure, 1);
  assert.deepEqual(ctx.dutyRows, []);

  const helpers2 = makeHelpers({
    getSharedState: async () => ({ employees: [{ username: 'gina' }] }),
    resolveStoreScopeStores: () => null,
    loadActiveDutyRowsForUser: async () => {
      throw new Error('load_fail');
    },
  });
  const ctx2 = await helpers2.getUserStoreAccessContext('gina', 'store_employee', {});
  assert.deepEqual(ctx2.dutyRows, []);
});
