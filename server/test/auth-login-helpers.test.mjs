import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoginUserPayload, LOCAL_TEST_ACCOUNTS } from '../domains/auth/login-helpers.js';

test('LOCAL_TEST_ACCOUNTS 含 admin 兜底', () => {
  assert.ok(LOCAL_TEST_ACCOUNTS.some((a) => a.username === 'admin' && a.role === 'admin'));
});

test('buildLoginUserPayload: 权限引擎成功写入 permissions', async () => {
  const payload = await buildLoginUserPayload(
    {
      getUserStoreAccessContext: async () => ({
        allowedStores: ['洪潮'],
        currentStore: '洪潮',
        primaryStore: '洪潮',
      }),
      getSharedState: async () => ({
        employees: [{ username: 'u1', permissionGroupId: 'pg1' }],
        permissionGroups: [{
          id: 'pg1',
          permissions: ['employees.read'],
        }],
      }),
    },
    {
      id: '1',
      username: 'u1',
      name: '甲',
      role: 'store_manager',
      stateStore: '洪潮',
      permissionGroupId: 'pg1',
      tenantId: 'default',
    }
  );
  assert.equal(payload.username, 'u1');
  assert.equal(payload.current_store, '洪潮');
  assert.equal(payload.permission_group_id, 'pg1');
  assert.ok(Array.isArray(payload.permissions));
});

test('buildLoginUserPayload: 权限引擎抛错回落 legacy', async () => {
  const payload = await buildLoginUserPayload(
    {
      getUserStoreAccessContext: async () => ({
        allowedStores: ['A'],
        currentStore: 'A',
        primaryStore: 'A',
      }),
      getSharedState: async () => {
        throw new Error('perm boom');
      },
    },
    {
      id: 2,
      username: 'u2',
      name: '乙',
      role: 'store_employee',
      stateStore: 'A',
      permissionGroupId: null,
      tenantId: 'default',
    }
  );
  assert.equal(payload.enforcement_mode, 'legacy');
  assert.deepEqual(payload.permissions, []);
  assert.equal(payload.permission_group_id, null);
});
