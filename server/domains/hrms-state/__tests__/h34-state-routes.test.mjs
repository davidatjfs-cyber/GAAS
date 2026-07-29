import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerStateRoutes } from '../routes.js';

function mockAuth(req, _res, next) {
  req.user = req._user || { role: 'admin', username: 'admin', tenant_id: 'default' };
  req.tenantId = req.user.tenant_id;
  next();
}

function baseDeps(overrides = {}) {
  return {
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    getSharedState: async () => ({}),
    resolveTenantIdDefault: () => 'default',
    deepRepairGarbledStrings: (d) => d,
    invalidateSharedStateCache: () => {},
    stripPasswordFieldsFromStateForClient: (d) => d,
    applyStatePeopleVisibilityForRole: async (d) => d,
    applyStatePutWhitelist: (ex, raw) => ({ next: { ...ex, ...raw }, ignoredKeys: [] }),
    upsertPayrollDomainFromState: async () => {},
    notifyAdminsDualWriteFailure: () => {},
    applyHrmsUserAccountGateFromEmployee: async () => {},
    ...overrides,
  };
}

async function withServer(deps, fn) {
  const app = express();
  app.use(express.json());
  registerStateRoutes(app, mockAuth, deps);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('GET /api/state 404 when missing row', async () => {
  await withServer(baseDeps(), async (base) => {
    const r = await fetch(base + '/api/state');
    assert.equal(r.status, 404);
  });
});

test('GET /api/state returns data from getSharedState (hydrate 收口)', async () => {
  await withServer(
    baseDeps({
      pool: {
        async query() {
          return { rows: [{ data: { hello: 1 } }] };
        },
      },
      getSharedState: async () => ({ hello: 1, pay: true }),
    }),
    async (base) => {
      const r = await fetch(base + '/api/state');
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.data.hello, 1);
      assert.equal(body.data.pay, true);
    }
  );
});

test('PUT /api/state non-admin 403; admin writes whitelist', async () => {
  const writes = [];
  const deps = baseDeps({
    pool: {
      async query(sql, params) {
        writes.push({ sql, params });
        return { rows: [] };
      },
    },
    getSharedState: async () => ({ keep: true }),
    applyStatePutWhitelist: (ex, raw) => ({
      next: { ...ex, settings: raw.settings },
      ignoredKeys: ['employees'],
    }),
  });

  await withServer(deps, async (base) => {
    const forbiddenApp = express();
    forbiddenApp.use(express.json());
    registerStateRoutes(
      forbiddenApp,
      (req, _res, next) => {
        req.user = { role: 'store_employee', username: 'u', tenant_id: 'default' };
        req.tenantId = 'default';
        next();
      },
      deps
    );
    const s = await new Promise((resolve) => {
      const srv = forbiddenApp.listen(0, '127.0.0.1', () => resolve(srv));
    });
    const port = s.address().port;
    try {
      const fr = await fetch(`http://127.0.0.1:${port}/api/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { settings: { a: 1 } } }),
      });
      assert.equal(fr.status, 403);
    } finally {
      await new Promise((r) => s.close(r));
    }

    const r = await fetch(base + '/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { settings: { a: 1 }, employees: [] } }),
    });
    assert.equal(r.status, 200);
  });
});
