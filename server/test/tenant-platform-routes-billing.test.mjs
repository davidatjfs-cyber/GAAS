/**
 * L1：routes-billing.js 收款账户 GET/PUT 异常路径（不依赖 PDF/DB）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTenantPlatformBillingRoutes } from '../domains/tenant-platform/routes-billing.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

function captureApp() {
  const routes = new Map();
  const app = {
    get(path, ...handlers) {
      routes.set(`GET ${path}`, handlers);
    },
    put(path, ...handlers) {
      routes.set(`PUT ${path}`, handlers);
    },
  };
  return { app, routes };
}

async function invoke(handlers, req, res) {
  for (let i = 0; i < handlers.length; i++) {
    let advanced = false;
    await new Promise((resolve, reject) => {
      const next = (err) => {
        advanced = true;
        if (err) {
          res.status(500).json({ error: String(err?.message || err) });
        }
        resolve();
      };
      Promise.resolve(handlers[i](req, res, next)).then(() => {
        if (res.headersSent || advanced) resolve();
      }, reject);
    });
    if (res.headersSent) break;
  }
}

function register(queryImpl) {
  const { app, routes } = captureApp();
  const pool = {
    query: async (...args) => {
      if (typeof queryImpl === 'function') return queryImpl(...args);
      return { rows: [] };
    },
  };
  registerTenantPlatformBillingRoutes(app, {
    pool,
    platformAdminRequired: (req, _res, next) => {
      req.platformAdmin = req.platformAdmin || { username: 'super1', role: 'super_admin' };
      next();
    },
  });
  return { routes };
}

test('GET billing-account：helper/DB 抛错 → 500 server_error', async () => {
  const { routes } = register(async () => {
    throw new Error('db down');
  });
  const res = mockRes();
  await invoke(routes.get('GET /api/admin/platform/billing-account'), {
    platformAdmin: { username: 'super1', role: 'super_admin' },
  }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'server_error');
  assert.match(String(res.body.message || ''), /db down/);
});

test('PUT billing-account：保存失败 → 500 server_error', async () => {
  const { routes } = register(async () => {
    throw new Error('save failed');
  });
  const res = mockRes();
  await invoke(routes.get('PUT /api/admin/platform/billing-account'), {
    platformAdmin: { username: 'super1', role: 'finance' },
    body: { account: { account_name: '甲', bank_name: '乙', bank_account_no: '1' } },
  }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'server_error');
  assert.match(String(res.body.message || ''), /save failed/);
});

test('GET billing-account：非财务角色被 gate 拒绝', async () => {
  const { routes } = register();
  const res = mockRes();
  await invoke(routes.get('GET /api/admin/platform/billing-account'), {
    platformAdmin: { username: 'sales1', role: 'sales' },
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'forbidden');
});
