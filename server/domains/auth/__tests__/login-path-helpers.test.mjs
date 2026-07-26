import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { tryDbUserLogin, tryLocalTestLogin } from '../login-path-helpers.js';

function baseDeps(overrides = {}) {
  return {
    pool: { query: async () => ({ rows: [] }) },
    JWT_SECRET: 'test-secret',
    normalizeRoleForJwt: (r) => String(r || 'store_employee'),
    normalizeUsersTableRole: (r) => String(r || 'employee'),
    employeeAccountShouldDisable: () => false,
    getUserStoreAccessContext: async () => ({
      allowedStores: [],
      currentStore: '',
      primaryStore: '',
    }),
    recordLogin: () => {},
    storeSessionNonce: async () => true,
    ...overrides,
  };
}

test('tryDbUserLogin: returns null when user not found', async () => {
  const out = await tryDbUserLogin(baseDeps(), {
    username: 'nobody',
    password: 'x',
    tenantId: 'default',
    sn: 'abc',
    reqLike: null,
  });
  assert.equal(out, null);
});

test('tryDbUserLogin: invalid password → 401', async () => {
  const hash = await bcrypt.hash('right', 4);
  const out = await tryDbUserLogin(baseDeps({
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
              is_active: true,
              tenant_id: 'default',
            }],
          };
        }
        return { rows: [] };
      },
    },
  }), {
    username: 'bob',
    password: 'wrong',
    tenantId: 'default',
    sn: 'abc',
    reqLike: null,
  });
  assert.equal(out.status, 401);
  assert.equal(out.body.error, 'invalid_credentials');
});

test('tryLocalTestLogin: null in production', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const out = await tryLocalTestLogin(baseDeps(), {
      username: 'admin',
      password: 'admin123',
      tenantId: 'default',
      sn: 'abc',
    });
    assert.equal(out, null);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('tryLocalTestLogin: succeeds for LOCAL_TEST_ACCOUNTS in test env', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    const out = await tryLocalTestLogin(baseDeps(), {
      username: 'admin',
      password: 'admin123',
      tenantId: 'default',
      sn: 'abc',
    });
    assert.equal(out.status, 200);
    assert.ok(out.body.token);
    assert.equal(out.body.user.username, 'admin');
  } finally {
    process.env.NODE_ENV = prev;
  }
});
