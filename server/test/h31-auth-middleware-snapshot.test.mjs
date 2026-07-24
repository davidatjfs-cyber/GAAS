import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthMiddlewareHelpers } from '../domains/auth/middleware.js';
import { createHrmsStateSnapshotHelpers } from '../domains/shared/hrms-state-snapshot.js';

function mockRes() {
  const out = { statusCode: 200, body: null };
  out.status = (c) => {
    out.statusCode = c;
    return out;
  };
  out.json = (b) => {
    out.body = b;
    return out;
  };
  return out;
}

test('authRequired: wecom callback bypass; missing token 401', async () => {
  const { authRequired } = createAuthMiddlewareHelpers({
    jwt: { verify: () => ({}) },
    jwtSecret: 's',
    pool: {},
    tenantContext: { run: async (_t, fn) => fn() },
    assertEmployeeLoginAllowedByState: async () => {},
    getSharedState: async () => ({}),
    pickMyStoreFromState: () => '',
    getUserStoreAccessContext: async () => ({
      primaryStore: '',
      currentStore: '',
      allowedStores: [],
    }),
  });

  let nexted = 0;
  await authRequired(
    { originalUrl: '/api/wecom/callback', headers: {} },
    mockRes(),
    () => {
      nexted += 1;
    }
  );
  assert.equal(nexted, 1);

  const res = mockRes();
  await authRequired({ originalUrl: '/api/x', headers: {}, query: {} }, res, () => {});
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('authRequired: enriches user and calls next', async () => {
  const queries = [];
  const { authRequired } = createAuthMiddlewareHelpers({
    jwt: {
      verify: () => ({ username: 'alice', role: 'store_employee', sn: 'n1', tenant_id: 't1' }),
    },
    jwtSecret: 'secret',
    pool: {
      async query(sql, params) {
        queries.push({ sql, params });
        if (/session_nonce/.test(sql)) return { rows: [{ session_nonce: 'n1' }] };
        if (/FROM users/i.test(sql)) return { rows: [{ role: 'store_manager' }] };
        return { rows: [] };
      },
    },
    tenantContext: {
      async run(tid, fn) {
        assert.equal(tid, 't1');
        return fn();
      },
    },
    assertEmployeeLoginAllowedByState: async () => {},
    getSharedState: async () => ({ employees: [{ username: 'alice', store: '洪潮' }] }),
    pickMyStoreFromState: (_s, u) => (u === 'alice' ? '洪潮' : ''),
    getUserStoreAccessContext: async () => ({
      primaryStore: '洪潮',
      currentStore: '洪潮',
      allowedStores: ['洪潮'],
    }),
  });

  const req = {
    originalUrl: '/api/me',
    headers: { authorization: 'Bearer tok' },
    query: {},
  };
  const res = mockRes();
  let nexted = 0;
  await authRequired(req, res, () => {
    nexted += 1;
  });
  assert.equal(nexted, 1);
  assert.equal(req.user.role, 'store_manager');
  assert.equal(req.user.store, '洪潮');
  assert.equal(req.tenantId, 't1');
  assert.ok(queries.some((q) => /session_nonce/.test(q.sql)));
});

test('captureHrmsStateSnapshotToDb skips when disabled', async () => {
  const prev = process.env.HRMS_STATE_SNAPSHOT_DISABLED;
  process.env.HRMS_STATE_SNAPSHOT_DISABLED = 'true';
  try {
    const { captureHrmsStateSnapshotToDb } = createHrmsStateSnapshotHelpers({
      pool: { async query() { throw new Error('should not query'); } },
    });
    const r = await captureHrmsStateSnapshotToDb();
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'disabled');
  } finally {
    if (prev === undefined) delete process.env.HRMS_STATE_SNAPSHOT_DISABLED;
    else process.env.HRMS_STATE_SNAPSHOT_DISABLED = prev;
  }
});

test('captureHrmsStateSnapshotToDb inserts and prunes', async () => {
  const sqls = [];
  const { captureHrmsStateSnapshotToDb } = createHrmsStateSnapshotHelpers({
    pool: {
      async query(sql, params) {
        sqls.push({ sql, params });
        if (/SELECT data FROM hrms_state/.test(sql)) {
          return { rows: [{ data: { a: 1 } }] };
        }
        return { rows: [] };
      },
    },
  });
  const r = await captureHrmsStateSnapshotToDb({ source: 'test', stateKey: 'default' });
  assert.equal(r.ok, true);
  assert.ok(r.byteSize > 0);
  assert.ok(sqls.some((q) => /INSERT INTO hrms_state_snapshots/.test(q.sql)));
  assert.ok(sqls.filter((q) => /DELETE FROM hrms_state_snapshots/.test(q.sql)).length >= 2);
});
