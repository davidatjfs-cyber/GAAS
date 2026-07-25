/**
 * L1：routes-billing.js 收款账户 GET/PUT + 账单 PDF 路径。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
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

function mockPdfRes() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  stream.statusCode = 200;
  stream.headers = {};
  stream.headersSent = false;
  stream.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  stream.json = function json(payload) {
    this.body = payload;
    this.headersSent = true;
    return this;
  };
  stream.setHeader = function setHeader(k, v) {
    this.headers[k] = v;
    // PDF 走 pipe，不会走 json()；标 headersSent 让 invoke 能结束当前 handler
    this.headersSent = true;
  };
  stream.done = new Promise((resolve) => stream.on('finish', () => resolve(Buffer.concat(chunks))));
  return stream;
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

test('GET billing-account / PUT 成功路径', async () => {
  {
    const { routes } = register(async (sql) => {
      if (String(sql).includes('billing_account')) {
        return {
          rows: [{
            config_value: {
              account_name: '甲公司',
              bank_name: '工行',
              bank_branch: '南京路',
              bank_account_no: '6222',
            },
          }],
        };
      }
      return { rows: [] };
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/platform/billing-account'), {
      platformAdmin: { username: 'fin1', role: 'finance' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.account.account_name, '甲公司');
  }
  {
    const { routes } = register(async () => ({ rows: [] }));
    const res = mockRes();
    await invoke(routes.get('PUT /api/admin/platform/billing-account'), {
      platformAdmin: { username: 'fin1', role: 'finance' },
      body: {
        account: {
          account_name: '乙公司',
          bank_name: '建行',
          bank_account_no: '6223',
        },
      },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.account.account_name, '乙公司');
  }
});

test('billing/pdf：未知租户 404；无签约价 + 收款账户 + 备注 → PDF', async () => {
  {
    const { routes } = register(async (sql) => {
      if (String(sql).includes('FROM tenants')) return { rows: [] };
      return { rows: [] };
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/tenants/:tenantId/billing/pdf'), {
      params: { tenantId: 'missing' },
      platformAdmin: { username: 'sales1', role: 'sales' },
    }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'tenant_not_found');
  }
  {
    const { routes } = register(async (sql) => {
      const s = String(sql);
      if (s.includes('FROM tenants')) return { rows: [{ name: '演示租户' }] };
      if (s.includes("config_key = 'platform_profile'")) {
        return {
          rows: [{
            config_value: {
              brand_color: '#112233',
              billing: {
                plan_name: '标准版',
                billing_cycle: 'monthly',
                next_invoice_at: '2026-08-01',
                billing_contact: '张三',
                billing_contact_email: 'a@b.com',
                billing_contact_wechat: 'wx1',
                delivery_method: 'wechat',
                notes: '请于月底前付款',
              },
            },
          }],
        };
      }
      if (s.includes('FROM sales_leads')) return { rows: [] };
      if (s.includes("config_key = 'billing_account'")) {
        return {
          rows: [{
            config_value: {
              account_name: '收款方',
              bank_name: '招行',
              bank_branch: '陆家嘴',
              bank_account_no: '6228',
            },
          }],
        };
      }
      return { rows: [] };
    });
    const res = mockPdfRes();
    await invoke(routes.get('GET /api/admin/tenants/:tenantId/billing/pdf'), {
      params: { tenantId: 't-demo' },
      platformAdmin: { username: 'sales1', role: 'sales' },
    }, res);
    const pdf = await res.done;
    assert.equal(res.headers['Content-Type'], 'application/pdf');
    assert.match(String(res.headers['Content-Disposition'] || ''), /billing-t-demo/);
    assert.ok(pdf.length > 500);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  }
});

test('billing/pdf：有签约价与账期；池抛错 500；headersSent 后只 end', async () => {
  {
    const { routes } = register(async (sql) => {
      const s = String(sql);
      if (s.includes('FROM tenants')) return { rows: [{ name: '签约租户' }] };
      if (s.includes("config_key = 'platform_profile'")) {
        return {
          rows: [{
            config_value: {
              billing: {
                plan_name: '旗舰',
                next_invoice_at: '2026-07-15T00:00:00.000Z',
                delivery_method: 'email',
              },
            },
          }],
        };
      }
      if (s.includes('FROM sales_leads')) {
        return {
          rows: [{
            id: 1,
            contract_price_fen: 128000,
            contract_billing_cycle: 'monthly',
            contract_billing_day: 15,
          }],
        };
      }
      if (s.includes("config_key = 'billing_account'")) return { rows: [{}] };
      return { rows: [] };
    });
    const res = mockPdfRes();
    await invoke(routes.get('GET /api/admin/tenants/:tenantId/billing/pdf'), {
      params: { tenantId: 't-paid' },
      platformAdmin: { username: 'sales1', role: 'sales' },
    }, res);
    const pdf = await res.done;
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 500);
  }
  {
    const { routes } = register(async () => {
      throw new Error('pdf db down');
    });
    const res = mockRes();
    await invoke(routes.get('GET /api/admin/tenants/:tenantId/billing/pdf'), {
      params: { tenantId: 't-x' },
      platformAdmin: { username: 'sales1', role: 'sales' },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'server_error');
  }
  {
    let ended = false;
    const { routes } = register(async () => {
      throw new Error('after headers');
    });
    const handlers = routes.get('GET /api/admin/tenants/:tenantId/billing/pdf');
    const biz = handlers[handlers.length - 1];
    await biz(
      { params: { tenantId: 't' } },
      {
        headersSent: true,
        status() { return this; },
        json() { return this; },
        setHeader() {},
        end() { ended = true; },
      }
    );
    assert.equal(ended, true);
  }
});
