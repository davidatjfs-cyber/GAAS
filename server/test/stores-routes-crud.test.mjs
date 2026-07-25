/**
 * domains/stores/routes-crud.js 直测（mock pool + state）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerStoresCrudRoutes } from '../domains/stores/routes-crud.js';
import { normalizeBrandId, getBrandsFromState } from '../domains/stores/brand-scope.js';

function authRequired(req, _res, next) {
  req.user = req.headers['x-test-user']
    ? JSON.parse(String(req.headers['x-test-user']))
    : { role: 'admin', username: 'admin', tenant_id: 'default' };
  req.tenantId = req.user.tenant_id || 'default';
  next();
}

async function boot(opts = {}) {
  let state = {
    stores: opts.stores || [{ id: 'store_1', name: '原店', address: '旧址', status: 'active' }],
    brands: [],
  };
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (opts.poolQuery) return opts.poolQuery(sql, params, queries);
      if (/from hrms_state where key/i.test(sql)) {
        return { rows: [{ data: state }] };
      }
      if (/sales_credit_accounts/i.test(sql)) return { rows: [] };
      if (/tenant_store_licenses/i.test(sql)) return { rows: [{ max_stores: 0 }] };
      if (/FROM licenses/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const app = express();
  app.use(express.json());
  registerStoresCrudRoutes(app, authRequired, {
    pool,
    getSharedState: async () => state,
    saveSharedState: async (next) => {
      state = next;
    },
    resolveTenantIdDefault: () => 'default',
    getCreditRisk: opts.getCreditRisk || (async () => null),
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
    queries,
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

test('GET /api/stores：列表映射字段', async () => {
  const app = await boot();
  try {
    const res = await jsonFetch(app.baseUrl, '/api/stores');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].name, '原店');
    assert.equal(res.body.items[0].is_active, true);
  } finally {
    await app.stop();
  }
});

test('PUT /api/stores/:id：缺参 / 404 / 成功更新画像字段', async () => {
  const app = await boot();
  try {
    const missName = await jsonFetch(app.baseUrl, '/api/stores/store_1', {
      method: 'PUT',
      body: JSON.stringify({ address: 'x' }),
    });
    assert.equal(missName.status, 400);
    assert.equal(missName.body.error, 'missing_name');

    const notFound = await jsonFetch(app.baseUrl, '/api/stores/nope', {
      method: 'PUT',
      body: JSON.stringify({ name: '新名' }),
    });
    assert.equal(notFound.status, 404);

    const ok = await jsonFetch(app.baseUrl, '/api/stores/store_1', {
      method: 'PUT',
      body: JSON.stringify({
        name: '新店名',
        brand: '洪潮',
        positioning: '正餐',
        seats: 40,
        status: 'inactive',
      }),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.item.name, '新店名');
    assert.equal(ok.body.item.positioning, '正餐');
    assert.equal(ok.body.item.status, 'inactive');
    assert.equal(app.getState().stores[0].name, '新店名');
  } finally {
    await app.stop();
  }
});

test('POST /api/stores：授信锁定 423；配额超限 403；成功创建', async () => {
  const locked = await boot({
    poolQuery: async (sql) => {
      if (/sales_credit_accounts/i.test(sql)) return { rows: [{ lead_id: 'L1' }] };
      if (/from hrms_state/i.test(sql)) return { rows: [{ data: { stores: [] } }] };
      return { rows: [] };
    },
    getCreditRisk: async () => ({ can_open_store: false, payment_type: 'cash' }),
    stores: [],
  });
  try {
    const res = await jsonFetch(locked.baseUrl, '/api/stores', {
      method: 'POST',
      body: JSON.stringify({ name: '禁开门店' }),
    });
    assert.equal(res.status, 423);
    assert.equal(res.body.error, 'credit_account_locked');
  } finally {
    await locked.stop();
  }

  const quota = await boot({
    poolQuery: async (sql) => {
      if (/sales_credit_accounts/i.test(sql)) return { rows: [] };
      if (/tenant_store_licenses/i.test(sql)) return { rows: [{ max_stores: 1 }] };
      if (/FROM licenses/i.test(sql)) return { rows: [] };
      if (/from hrms_state/i.test(sql)) return { rows: [{ data: { stores: [{ id: 'x', name: '已有' }] } }] };
      return { rows: [] };
    },
    stores: [{ id: 'x', name: '已有' }],
  });
  try {
    const res = await jsonFetch(quota.baseUrl, '/api/stores', {
      method: 'POST',
      body: JSON.stringify({ name: '超额店' }),
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'store_quota_exceeded');
  } finally {
    await quota.stop();
  }

  const okApp = await boot({ stores: [] });
  try {
    const res = await jsonFetch(okApp.baseUrl, '/api/stores', {
      method: 'POST',
      body: JSON.stringify({ name: '新开店', brand: '马己仙', city: '上海' }),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.name, '新开店');
    assert.equal(res.body.item.city, '上海');
    assert.equal(okApp.getState().stores.length, 1);
  } finally {
    await okApp.stop();
  }
});

test('POST /api/stores/:name/location：缺坐标 / 404 / 成功', async () => {
  const app = await boot();
  try {
    const bad = await jsonFetch(app.baseUrl, '/api/stores/' + encodeURIComponent('原店') + '/location', {
      method: 'POST',
      body: JSON.stringify({ latitude: 'x', longitude: 1 }),
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'missing_location');

    const miss = await jsonFetch(app.baseUrl, '/api/stores/' + encodeURIComponent('没有') + '/location', {
      method: 'POST',
      body: JSON.stringify({ latitude: 31.2, longitude: 121.5 }),
    });
    assert.equal(miss.status, 404);

    const ok = await jsonFetch(app.baseUrl, '/api/stores/' + encodeURIComponent('原店') + '/location', {
      method: 'POST',
      body: JSON.stringify({ latitude: 31.2, longitude: 121.5, address: '新地址' }),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.store.latitude, 31.2);
    assert.equal(ok.body.store.address, '新地址');
  } finally {
    await app.stop();
  }
});
