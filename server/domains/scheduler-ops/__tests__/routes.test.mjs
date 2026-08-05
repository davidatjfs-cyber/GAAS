/**
 * /api/ops/schedulers：鉴权与返回结构。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSchedulerOpsRoutes } from '../routes.js';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
  };
}

function captureApp() {
  const routes = new Map();
  const app = { get(path, ...handlers) { routes.set(`GET ${path}`, handlers); } };
  return { app, routes };
}

const okPool = () => ({
  query: async (sql) => {
    if (/FROM scheduler_heartbeat/.test(sql)) return { rows: [] };
    if (/employee_scores/.test(sql)) return { rows: [{ latest_period: '2099-01' }] };
    return { rows: [{ latest: new Date() }] };
  },
});

function handlerFor(routes) {
  const handlers = routes.get('GET /api/ops/schedulers');
  assert.ok(handlers, '路由未注册');
  return handlers[handlers.length - 1];
}

test('注册 GET /api/ops/schedulers 并挂上 authRequired', () => {
  const { app, routes } = captureApp();
  const authRequired = () => {};
  registerSchedulerOpsRoutes(app, authRequired, { pool: okPool });
  const handlers = routes.get('GET /api/ops/schedulers');
  assert.equal(handlers[0], authRequired, '必须经过 authRequired');
});

test('非运维角色返回 403', async () => {
  const { app, routes } = captureApp();
  registerSchedulerOpsRoutes(app, () => {}, { pool: okPool });
  const res = mockRes();
  await handlerFor(routes)({ user: { role: 'store_manager' } }, res);
  assert.equal(res.statusCode, 403);
});

test('admin 拿到 schedulers + outputs 两段结构', async () => {
  const { app, routes } = captureApp();
  registerSchedulerOpsRoutes(app, () => {}, { pool: okPool });
  const res = mockRes();
  await handlerFor(routes)({ user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.schedulers, '缺 schedulers 段');
  assert.ok(res.body.outputs, '缺 outputs 段');
  assert.ok(Array.isArray(res.body.schedulers.tasks));
  assert.ok(Array.isArray(res.body.outputs.items));
  assert.ok(res.body.generatedAt);
});

test('DB 异常时返回 500 且不泄露内部错误信息', async () => {
  const { app, routes } = captureApp();
  const boomPool = () => { throw new Error('connection refused to 127.0.0.1:5432'); };
  registerSchedulerOpsRoutes(app, () => {}, { pool: boomPool });
  const res = mockRes();
  await handlerFor(routes)({ user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'internal_error');
  assert.ok(!JSON.stringify(res.body).includes('5432'), '不得把连接串/内部细节回给前端');
});
