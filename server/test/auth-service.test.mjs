import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {
  login,
  loginInTenant,
  changePassword,
  switchStore,
  loginAs,
  getAuthMe,
  heartbeat,
} from '../domains/auth/service.js';

const JWT_SECRET = 'test-jwt-secret-for-auth-service';

function baseDeps(overrides = {}) {
  return {
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async () => ({}),
        release: () => {},
      }),
    },
    JWT_SECRET,
    DATABASE_URL: '',
    getSharedState: async () => ({}),
    normalizeRoleForJwt: (r) => String(r || '').trim() || 'store_employee',
    normalizeUsersTableRole: (r) => String(r || 'employee'),
    employeeAccountShouldDisable: () => false,
    getUserStoreAccessContext: async () => ({
      allowedStores: ['A店'],
      currentStore: 'A店',
      primaryStore: 'A店',
    }),
    pickMyStoreFromState: () => 'A店',
    recordLogin: () => {},
    recordLogout: async () => {},
    storeSessionNonce: async () => true,
    loadTenantRuntimeStatus: async () => ({ loginAllowed: true }),
    ...overrides,
  };
}

test('login: missing username/password → missing_credentials', async () => {
  const result = await login({ body: { username: '', password: '' } }, baseDeps());
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'missing_credentials');

  const result2 = await login({ body: { username: 'admin' } }, baseDeps());
  assert.equal(result2.status, 400);
  assert.equal(result2.body.error, 'missing_credentials');
});

test('login: 非法 tenant_id → invalid_tenant_id', async () => {
  const result = await login(
    { body: { username: 'a', password: 'b', tenant_id: '__system__' } },
    baseDeps({ DATABASE_URL: 'postgres://mock' })
  );
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'invalid_tenant_id');
});

test('loginInTenant: tenant 不可用 → 403', async () => {
  const result = await loginInTenant(
    { body: { username: 'bob', password: 'x' } },
    baseDeps({
      DATABASE_URL: 'postgres://mock',
      loadTenantRuntimeStatus: async () => ({ loginAllowed: false, reason: 'tenant_suspended' }),
    }),
    'default'
  );
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'tenant_suspended');
});

test('loginInTenant: is_active=false → user_inactive', async () => {
  const hash = await bcrypt.hash('ok-pass', 4);
  const result = await loginInTenant(
    { body: { username: 'bob', password: 'ok-pass' } },
    baseDeps({
      DATABASE_URL: 'postgres://mock',
      pool: {
        query: async (sql) => {
          if (/from users/i.test(String(sql))) {
            return {
              rows: [{
                id: 1,
                username: 'bob',
                password_hash: hash,
                real_name: 'Bob',
                role: 'admin',
                is_active: false,
                tenant_id: 'default',
              }],
            };
          }
          return { rows: [] };
        },
      },
    }),
    'default'
  );
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'user_inactive');
});

test('loginInTenant: session_persist_failed → 503', async () => {
  const hash = await bcrypt.hash('ok-pass', 4);
  const result = await loginInTenant(
    { body: { username: 'bob', password: 'ok-pass' } },
    baseDeps({
      DATABASE_URL: 'postgres://mock',
      storeSessionNonce: async () => false,
      pool: {
        query: async (sql) => {
          if (/from users/i.test(String(sql))) {
            return {
              rows: [{
                id: 1,
                username: 'bob',
                password_hash: hash,
                real_name: 'Bob',
                role: 'store_manager',
                is_active: true,
                tenant_id: 'default',
              }],
            };
          }
          return { rows: [] };
        },
      },
    }),
    'default'
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'session_persist_failed');
});

test('login: LOCAL_TEST_ACCOUNTS path when DATABASE_URL empty (non-production)', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const result = await login(
      { body: { username: 'admin', password: 'admin123' } },
      baseDeps({ DATABASE_URL: '' })
    );
    assert.equal(result.status, 200);
    assert.ok(result.body.token);
    assert.equal(result.body.user.username, 'admin');
    assert.equal(result.body.user.role, 'admin');
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('loginInTenant: bcrypt mismatch → invalid_credentials', async () => {
  const hash = await bcrypt.hash('correct-password', 4);
  const deps = baseDeps({
    DATABASE_URL: 'postgres://mock',
    pool: {
      query: async (sql) => {
        if (String(sql).includes('from users') || String(sql).includes('FROM users')) {
          return {
            rows: [{
              id: 9,
              username: 'bob',
              password_hash: hash,
              real_name: 'Bob',
              role: 'admin',
              is_active: true,
              tenant_id: 'default',
            }],
          };
        }
        return { rows: [] };
      },
    },
  });
  const result = await loginInTenant(
    { body: { username: 'bob', password: 'wrong-password' } },
    deps,
    'default'
  );
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'invalid_credentials');
});

test('changePassword: missing_params and old_password_invalid', async () => {
  const missing = await changePassword(
    { user: { username: 'alice' }, tenantId: 'default', body: {} },
    baseDeps()
  );
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'missing_params');

  const hash = await bcrypt.hash('old-pass-1', 4);
  const wrong = await changePassword(
    {
      user: { username: 'alice' },
      tenantId: 'default',
      body: { oldPassword: 'not-old', newPassword: 'Newpass12' },
    },
    baseDeps({
      pool: {
        query: async (sql) => {
          if (String(sql).includes('select id, username, password_hash')) {
            return { rows: [{ id: 1, username: 'alice', password_hash: hash }] };
          }
          return { rows: [] };
        },
      },
    })
  );
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'old_password_invalid');
});

test('switchStore: missing_store and store_forbidden', async () => {
  const missing = await switchStore(
    { user: { username: 'u1', role: 'store_manager' }, body: {} },
    baseDeps()
  );
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'missing_store');

  const forbidden = await switchStore(
    { user: { username: 'u1', role: 'store_manager', store: 'A店' }, body: { store: 'B店' } },
    baseDeps({
      getUserStoreAccessContext: async () => ({
        allowedStores: ['A店'],
        currentStore: 'A店',
        primaryStore: 'A店',
      }),
    })
  );
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, 'store_forbidden');
});

test('loginAs: non-admin → forbidden', async () => {
  const result = await loginAs(
    {
      user: { username: 'clerk', role: 'store_employee' },
      tenantId: 'default',
      body: { username: 'target', reason: 'support' },
    },
    baseDeps()
  );
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'forbidden');
});

test('getAuthMe and heartbeat: ok structure', async () => {
  const me = await getAuthMe(
    {
      user: { username: 'admin', role: 'admin', store: 'A店', current_store: 'A店' },
      tenantId: 'default',
    },
    baseDeps({
      getSharedState: async () => ({
        employees: [{ username: 'admin', permissionGroupId: 'pg1' }],
      }),
    })
  );
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, 'admin');
  assert.equal(me.body.user.permission_group_id, 'pg1');
  assert.ok(Array.isArray(me.body.user.allowed_stores));

  const beat = await heartbeat({ user: { username: 'admin' } }, baseDeps());
  assert.equal(beat.status, 200);
  assert.deepEqual(beat.body, { ok: true });
});
