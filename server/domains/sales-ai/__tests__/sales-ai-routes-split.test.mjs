import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSalesAiRoutes } from '../routes.js';

function createMockApp() {
  const routes = [];
  const app = {
    get(path, ...handlers) {
      routes.push({ method: 'GET', path, handlers });
    },
    post(path, ...handlers) {
      routes.push({ method: 'POST', path, handlers });
    },
    put(path, ...handlers) {
      routes.push({ method: 'PUT', path, handlers });
    },
    patch(path, ...handlers) {
      routes.push({ method: 'PATCH', path, handlers });
    },
    delete(path, ...handlers) {
      routes.push({ method: 'DELETE', path, handlers });
    },
    use(path, ...handlers) {
      if (typeof path === 'string') routes.push({ method: 'USE', path, handlers });
      else routes.push({ method: 'USE', path: '(anonymous)', handlers: [path, ...handlers] });
    },
  };
  return { app, routes };
}

test('registerSalesAiRoutes registers expected sales routes', () => {
  const { app, routes } = createMockApp();
  const pool = { query: async () => ({ rows: [] }) };
  const platformAdminRequired = (_req, _res, next) => (typeof next === 'function' ? next() : undefined);

  registerSalesAiRoutes(app, pool, platformAdminRequired, {});

  assert.ok(routes.length >= 80, `expected >= 80 routes, got ${routes.length}`);

  const paths = routes.map((r) => r.path);
  assert.ok(paths.includes('/api/admin/sales/leads'), 'missing GET /api/admin/sales/leads');
  assert.ok(paths.includes('/api/wecom/kf/callback'), 'missing /api/wecom/kf/callback');

  const kfGet = routes.find((r) => r.method === 'GET' && r.path === '/api/wecom/kf/callback');
  const kfPost = routes.find((r) => r.method === 'POST' && r.path === '/api/wecom/kf/callback');
  assert.ok(kfGet, 'missing GET handler for kf callback');
  assert.ok(kfPost, 'missing POST handler for kf callback');

  const leadScope = routes.find((r) => r.method === 'USE' && r.path === '/api/admin/sales/leads/:id');
  assert.ok(leadScope, 'missing lead scope middleware');
});

test('sales-ai-routes shim re-exports registerSalesAiRoutes from domain', async () => {
  const shim = await import('../../../sales-ai-routes.js');
  assert.equal(shim.registerSalesAiRoutes, registerSalesAiRoutes);
});
