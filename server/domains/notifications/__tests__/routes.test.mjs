/**
 * 通知路由：GET列表/POST标记已读(2026-07-29新增)/DELETE/POST批量创建。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerNotificationsWriteRoutes } from '../routes.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
  };
  return res;
}

function captureApp() {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); },
    delete(path, ...handlers) { routes.set(`DELETE ${path}`, handlers); },
  };
  return { app, routes };
}

async function invoke(handlers, req, res) {
  for (const h of handlers) {
    let advanced = false;
    await new Promise((resolve, reject) => {
      const next = (err) => {
        advanced = true;
        if (err) res.status(500).json({ error: String(err?.message || err) });
        resolve();
      };
      Promise.resolve(h(req, res, next)).then(() => {
        if (res.headersSent || advanced) resolve();
      }, reject);
    });
    if (res.headersSent) break;
  }
}

const authRequired = (req, _res, next) => next();

function register(queryImpl) {
  const { app, routes } = captureApp();
  const calls = [];
  const pool = {
    query: async (...args) => {
      calls.push(args);
      if (typeof queryImpl === 'function') return queryImpl(...args);
      return { rows: [] };
    },
  };
  registerNotificationsWriteRoutes(app, authRequired, { pool, resolveTenantIdDefault: () => 'default' });
  return { routes, calls };
}

test('GET /api/notifications: missing username → 400', async () => {
  const { routes } = register();
  const res = mockRes();
  await invoke(routes.get('GET /api/notifications'), { user: {}, query: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('GET /api/notifications: returns items for the requesting user', async () => {
  const rows = [{ id: 1, title: 't', message: 'm', type: 'system', meta: {}, created_at: new Date(), read_at: null }];
  const { routes, calls } = register(() => ({ rows }));
  const res = mockRes();
  await invoke(routes.get('GET /api/notifications'), { user: { username: 'emp1' }, query: { limit: '5' } }, res);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.items, rows);
  assert.equal(calls[0][1][1], 'emp1');
});

test('GET /api/notifications: db error → 500', async () => {
  const { routes } = register(() => { throw new Error('db down'); });
  const res = mockRes();
  await invoke(routes.get('GET /api/notifications'), { user: { username: 'emp1' }, query: {} }, res);
  assert.equal(res.statusCode, 500);
});

test('POST /api/notifications/:id/read: missing id → 400', async () => {
  const { routes } = register();
  const res = mockRes();
  await invoke(routes.get('POST /api/notifications/:id/read'), { user: { username: 'emp1' }, params: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('POST /api/notifications/:id/read: marks read for the owning user', async () => {
  const { routes, calls } = register();
  const res = mockRes();
  await invoke(routes.get('POST /api/notifications/:id/read'), { user: { username: 'emp1' }, params: { id: '7' } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(calls[0][1][0], '7');
  assert.equal(calls[0][1][2], 'emp1');
});

test('POST /api/notifications/:id/read: db error → 500', async () => {
  const { routes } = register(() => { throw new Error('db down'); });
  const res = mockRes();
  await invoke(routes.get('POST /api/notifications/:id/read'), { user: { username: 'emp1' }, params: { id: '7' } }, res);
  assert.equal(res.statusCode, 500);
});

test('DELETE /api/notifications/:id: non-admin → 403', async () => {
  const { routes } = register();
  const res = mockRes();
  await invoke(routes.get('DELETE /api/notifications/:id'), { user: { role: 'store_manager' }, params: { id: '1' } }, res);
  assert.equal(res.statusCode, 403);
});

test('DELETE /api/notifications/:id: missing id → 400', async () => {
  const { routes } = register();
  const res = mockRes();
  await invoke(routes.get('DELETE /api/notifications/:id'), { user: { role: 'admin' }, params: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('DELETE /api/notifications/:id: not found → ok with note', async () => {
  const { routes } = register(() => ({ rowCount: 0 }));
  const res = mockRes();
  await invoke(routes.get('DELETE /api/notifications/:id'), { user: { role: 'admin' }, params: { id: '1' } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.note, 'not_in_db');
});

test('DELETE /api/notifications/:id: deletes and reports count', async () => {
  const { routes } = register(() => ({ rowCount: 1 }));
  const res = mockRes();
  await invoke(routes.get('DELETE /api/notifications/:id'), { user: { role: 'admin' }, params: { id: '1' } }, res);
  assert.equal(res.body.deleted, 1);
});

test('DELETE /api/notifications/:id: db error → 500', async () => {
  const { routes } = register(() => { throw new Error('db down'); });
  const res = mockRes();
  await invoke(routes.get('DELETE /api/notifications/:id'), { user: { role: 'admin' }, params: { id: '1' } }, res);
  assert.equal(res.statusCode, 500);
});

test('POST /api/notifications/batch: empty → 400', async () => {
  const { routes } = register();
  const res = mockRes();
  await invoke(routes.get('POST /api/notifications/batch'), { body: { notifications: [] } }, res);
  assert.equal(res.statusCode, 400);
});

test('POST /api/notifications/batch: skips rows missing target/title, inserts the rest', async () => {
  const { routes, calls } = register(() => ({ rows: [{ id: 5 }] }));
  const res = mockRes();
  await invoke(routes.get('POST /api/notifications/batch'), {
    body: { notifications: [{ title: 'no target' }, { targetUser: 'emp1', title: 'hi', message: 'm', type: 'system', meta: { a: 1 } }] },
  }, res);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.ids, [5]);
  assert.equal(calls.length, 1);
});

test('POST /api/notifications/batch: db error → 500', async () => {
  const { routes } = register(() => { throw new Error('db down'); });
  const res = mockRes();
  await invoke(routes.get('POST /api/notifications/batch'), {
    body: { notifications: [{ targetUser: 'emp1', title: 'hi' }] },
  }, res);
  assert.equal(res.statusCode, 500);
});
