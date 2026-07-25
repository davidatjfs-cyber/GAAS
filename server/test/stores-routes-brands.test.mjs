/**
 * domains/stores/routes-brands.js 直测（mock deps + 轻量 express）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerBrandsRoutes } from '../domains/stores/routes-brands.js';
import { normalizeBrandId, getBrandsFromState } from '../domains/stores/brand-scope.js';

function authRequired(req, _res, next) {
  req.user = req.headers['x-test-user']
    ? JSON.parse(String(req.headers['x-test-user']))
    : { role: 'admin', username: 'admin' };
  next();
}

async function boot() {
  let state = { brands: [], stores: [] };
  const app = express();
  app.use(express.json());
  registerBrandsRoutes(app, authRequired, {
    getSharedState: async () => state,
    saveSharedState: async (next) => {
      state = next;
    },
    hrmsNowISO: () => '2026-07-26T00:00:00.000Z',
    normalizeBrandId,
    getBrandsFromState,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    getState: () => state,
    stop: () => new Promise((r) => server.close(() => r())),
  };
}

async function jsonFetch(baseUrl, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.user) headers['x-test-user'] = JSON.stringify(opts.user);
  const res = await fetch(baseUrl + path, { ...opts, headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test('GET/POST/PUT /api/brands 主路径与权限', async () => {
  const app = await boot();
  try {
    const list0 = await jsonFetch(app.baseUrl, '/api/brands');
    assert.equal(list0.status, 200);
    assert.ok(Array.isArray(list0.body.items));

    const forbidden = await jsonFetch(app.baseUrl, '/api/brands', {
      method: 'POST',
      user: { role: 'store_employee', username: 'e1' },
      body: JSON.stringify({ name: '品牌X' }),
    });
    assert.equal(forbidden.status, 403);

    const missing = await jsonFetch(app.baseUrl, '/api/brands', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'missing_name');

    const created = await jsonFetch(app.baseUrl, '/api/brands', {
      method: 'POST',
      body: JSON.stringify({ name: '测试品牌甲', config: { sopKeypoints: ['k1'] } }),
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.ok, true);
    assert.equal(created.body.item.name, '测试品牌甲');
    const brandId = created.body.item.id;
    assert.ok(brandId);

    // 门店挂同 brandId，便于 PUT 时级联改名
    const st = app.getState();
    st.stores = [{ id: 's1', name: '店1', brandId, brand: '测试品牌甲', brandName: '测试品牌甲' }];

    const list1 = await jsonFetch(app.baseUrl, '/api/brands');
    assert.ok(list1.body.items.some((b) => b.id === brandId));

    const putForbidden = await jsonFetch(app.baseUrl, `/api/brands/${brandId}`, {
      method: 'PUT',
      user: { role: 'store_employee', username: 'e1' },
      body: JSON.stringify({ name: '改名' }),
    });
    assert.equal(putForbidden.status, 403);

    const notFound = await jsonFetch(app.baseUrl, '/api/brands/no_such_brand', {
      method: 'PUT',
      body: JSON.stringify({ name: '改名' }),
    });
    assert.equal(notFound.status, 404);

    const updated = await jsonFetch(app.baseUrl, `/api/brands/${brandId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: '测试品牌乙' }),
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.item.name, '测试品牌乙');
    assert.equal(app.getState().stores[0].brand, '测试品牌乙');
    assert.equal(app.getState().stores[0].brandName, '测试品牌乙');
  } finally {
    await app.stop();
  }
});
