/**
 * L1：routes-auth.js 平台登录/bootstrap/账号/审计日志 HTTP 早退分支。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { registerTenantPlatformAuthRoutes } from '../routes-auth.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headersSent: false,
    sentFile: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
    sendFile(p) {
      this.sentFile = p;
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
      const paths = Array.isArray(path) ? path : [path];
      for (const p of paths) routes.set(`GET ${p}`, handlers);
    },
    post(path, ...handlers) {
      routes.set(`POST ${path}`, handlers);
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

function register(overrides = {}) {
  const { app, routes } = captureApp();
  const calls = [];
  const pool = {
    query: async (...args) => {
      calls.push(args);
      if (typeof overrides.queryImpl === 'function') return overrides.queryImpl(...args);
      return { rows: [] };
    },
  };
  const passthrough = (_req, _res, next) => next();
  registerTenantPlatformAuthRoutes(app, {
    pool,
    platformAdminRequired: overrides.platformAdminRequired || ((req, _res, next) => {
      req.platformAdmin = req.platformAdmin || { username: 'super1', role: 'super_admin' };
      next();
    }),
    platformAdminSessionRequired: overrides.platformAdminSessionRequired || ((req, _res, next) => {
      req.platformAdmin = req.platformAdmin || { username: 'super1', role: 'super_admin' };
      next();
    }),
    loginRateLimit: passthrough,
    PLATFORM_ADMIN_SECRET: overrides.PLATFORM_ADMIN_SECRET === undefined
      ? 'bootstrap-secret'
      : overrides.PLATFORM_ADMIN_SECRET,
    PLATFORM_ADMIN_JWT_SECRET: 'jwt-test-secret',
  });
  return { routes, calls, pool };
}

test('GET /sales-crm → sendFile', async () => {
  const { routes } = register();
  const res = mockRes();
  await invoke(routes.get('GET /sales-crm'), {}, res);
  assert.ok(res.sentFile);
  assert.match(String(res.sentFile), /platform-admin\.html$/);
});

test('bootstrap：未配置 SECRET / 错 secret / 已存在 / 短密码 / 成功', async () => {
  {
    const { routes } = register({ PLATFORM_ADMIN_SECRET: '' });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/bootstrap'), {
      headers: {},
      body: { username: 'a', password: '12345678' },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'server_config_error');
  }
  {
    const { routes } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/bootstrap'), {
      headers: { 'x-platform-admin-secret': 'wrong' },
      body: { username: 'a', password: '12345678' },
    }, res);
    assert.equal(res.statusCode, 401);
  }
  {
    const { routes } = register({
      queryImpl: async (sql) => {
        if (String(sql).includes('LIMIT 1') && String(sql).includes('platform_admins')) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      },
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/bootstrap'), {
      headers: { 'x-platform-admin-secret': 'bootstrap-secret' },
      body: { username: 'a', password: '12345678' },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, 'already_bootstrapped');
  }
  {
    const { routes } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/bootstrap'), {
      headers: { 'x-platform-admin-secret': 'bootstrap-secret' },
      body: { username: 'a', password: 'short' },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_input');
  }
  {
    const { routes, calls } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/bootstrap'), {
      headers: { 'x-platform-admin-secret': 'bootstrap-secret' },
      body: { username: 'rootadmin', password: '12345678', real_name: '超管' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(calls.some((c) => String(c[0]).includes('INSERT INTO platform_admins')));
  }
  {
    const { routes } = register({
      queryImpl: async (sql) => {
        if (String(sql).includes('INSERT INTO platform_admins')) {
          throw new Error('insert boom');
        }
        return { rows: [] };
      },
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/bootstrap'), {
      headers: { 'x-platform-admin-secret': 'bootstrap-secret' },
      body: { username: 'rootadmin', password: '12345678' },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'server_error');
  }
});

test('login：缺凭证 / inactive / 错密 / 成功 / 池抛错', async () => {
  const hash = await bcrypt.hash('Pass12345', 10);
  {
    const { routes } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/login'), { body: {}, headers: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'missing_credentials');
  }
  {
    const { routes } = register({
      queryImpl: async () => ({
        rows: [{ id: 1, username: 'a', password_hash: hash, real_name: 'A', status: 'disabled', role: 'super_admin' }],
      }),
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/login'), {
      body: { username: 'a', password: 'Pass12345' },
      headers: {},
    }, res);
    assert.equal(res.statusCode, 401);
  }
  {
    const { routes } = register({
      queryImpl: async () => ({
        rows: [{ id: 1, username: 'a', password_hash: hash, real_name: 'A', status: 'active', role: 'super_admin' }],
      }),
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/login'), {
      body: { username: 'a', password: 'wrong-password' },
      headers: {},
    }, res);
    assert.equal(res.statusCode, 401);
  }
  {
    const { routes } = register({
      queryImpl: async (sql) => {
        if (String(sql).includes('SELECT id, username')) {
          return {
            rows: [{ id: 1, username: 'a', password_hash: hash, real_name: 'A', status: 'active', role: 'auditor' }],
          };
        }
        return { rows: [] };
      },
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/login'), {
      body: { username: 'a', password: 'Pass12345' },
      headers: {},
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.token);
    assert.equal(res.body.admin.role, 'auditor');
  }
  {
    const { routes } = register({
      queryImpl: async () => {
        throw new Error('db down');
      },
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/login'), {
      body: { username: 'a', password: 'Pass12345' },
      headers: {},
    }, res);
    assert.equal(res.statusCode, 500);
  }
});

test('POST accounts：invalid_input / invalid_role / 成功 / duplicate 409 / 其它 500', async () => {
  {
    const { routes } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/accounts'), {
      body: { username: 'x', password: 'short', role: 'super_admin' },
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_input');
  }
  {
    const { routes } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/accounts'), {
      body: { username: 'x', password: '12345678', role: 'not_a_role' },
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_role');
  }
  {
    const { routes } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/accounts'), {
      body: { username: 'new1', password: '12345678', role: 'sales', real_name: '销售' },
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
  }
  {
    const { routes } = register({
      queryImpl: async () => {
        throw new Error('duplicate key value');
      },
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/accounts'), {
      body: { username: 'new1', password: '12345678', role: 'sales' },
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 409);
  }
  {
    const { routes } = register({
      queryImpl: async () => {
        throw new Error('other failure');
      },
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/accounts'), {
      body: { username: 'new1', password: '12345678', role: 'sales' },
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 500);
  }
});

test('login：账号不存在；role 空回落 super_admin；last_login 更新失败仍 200', async () => {
  const hash = await bcrypt.hash('Pass12345', 10);
  {
    const { routes } = register({
      queryImpl: async () => ({ rows: [] }),
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/login'), {
      body: { username: 'ghost', password: 'Pass12345' },
      headers: {},
    }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'invalid_credentials');
  }
  {
    const { routes } = register({
      queryImpl: async (sql) => {
        if (String(sql).includes('SELECT id, username')) {
          return {
            rows: [{
              id: 9,
              username: 'norole',
              password_hash: hash,
              real_name: '无角色',
              status: 'active',
              role: null,
            }],
          };
        }
        if (String(sql).includes('last_login_at')) {
          throw new Error('update fail');
        }
        return { rows: [] };
      },
    });
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/login'), {
      body: { username: 'norole', password: 'Pass12345' },
      headers: {},
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.admin.role, 'super_admin');
    assert.ok(res.body.token);
  }
});

test('bootstrap 缺 header；accounts 无 real_name；audit 默认 limit / super_admin', async () => {
  {
    const { routes } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/bootstrap'), {
      headers: {},
      body: { username: 'a', password: '12345678' },
    }, res);
    assert.equal(res.statusCode, 401);
  }
  {
    const { routes, calls } = register();
    const res = mockRes();
    await invoke(routes.get('POST /api/admin/auth/accounts'), {
      body: { username: 'new2', password: '12345678', role: 'finance' },
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 200);
    const ins = calls.find((c) => String(c[0]).includes('INSERT INTO platform_admins'));
    assert.equal(ins[1][2], 'new2');
  }
  {
    const { routes, calls } = register({
      platformAdminSessionRequired: (req, _res, next) => {
        req.platformAdmin = { username: 'super1', role: 'super_admin' };
        next();
      },
      queryImpl: async () => ({ rows: [] }),
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/auth/audit-log'), {
      query: {},
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(calls[0][1][0], 200);
  }
  {
    const { routes } = register();
    const res = mockRes();
    await invoke(routes.get('GET /sales-crm/'), {}, res);
    assert.ok(res.sentFile);
  }
});

test('GET accounts catch → 500；audit-log 403/200/limit clamp/500', async () => {
  {
    const { routes } = register({
      queryImpl: async () => ({
        rows: [{ username: 'super1', real_name: '超管', status: 'active', role: 'super_admin' }],
      }),
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/auth/accounts'), {
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.accounts.length, 1);
  }
  {
    const { routes } = register({
      queryImpl: async () => {
        throw new Error('list fail');
      },
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/auth/accounts'), {
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 500);
  }
  {
    const { routes } = register({
      platformAdminSessionRequired: (req, _res, next) => {
        req.platformAdmin = { username: 'sales1', role: 'sales' };
        next();
      },
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/auth/audit-log'), {
      query: {},
      platformAdmin: { username: 'sales1', role: 'sales' },
    }, res);
    assert.equal(res.statusCode, 403);
  }
  {
    const { routes, calls } = register({
      platformAdminSessionRequired: (req, _res, next) => {
        req.platformAdmin = { username: 'aud1', role: 'auditor' };
        next();
      },
      queryImpl: async () => ({ rows: [{ admin_username: 'a', method: 'GET', path: '/x' }] }),
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/auth/audit-log'), {
      query: { limit: '99999' },
      platformAdmin: { username: 'aud1', role: 'auditor' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(calls[0][1][0], 1000);
  }
  {
    const { routes } = register({
      platformAdminSessionRequired: (req, _res, next) => {
        req.platformAdmin = { username: 'super1', role: 'super_admin' };
        next();
      },
      queryImpl: async () => {
        throw new Error('audit fail');
      },
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/auth/audit-log'), {
      query: {},
      platformAdmin: { username: 'super1', role: 'super_admin' },
    }, res);
    assert.equal(res.statusCode, 500);
  }
});
