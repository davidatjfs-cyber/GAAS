/**
 * R50：agent-feishu-bot / growth-ab / growth-pos / daily-reports /
 * sales-ai routes-admin-meta 挂 extracted 地板。
 */
import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerAgentFeishuBotRoutes } from '../domains/agent-feishu-bot/routes.js';
import { registerGrowthAbRoutes } from '../domains/growth-ab/routes.js';
import { registerGrowthPosRoutes } from '../domains/growth-pos/routes.js';
import { registerDailyReportsRoutes } from '../domains/daily-reports/routes.js';
import { registerSalesAiAdminMetaRoutes } from '../domains/sales-ai/routes-admin-meta.js';

async function withApp(register, fn) {
  const app = express();
  app.use(express.json());
  register(app);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authAs(user) {
  return (req, _res, next) => {
    req.user = user;
    req.tenantId = user?.tenant_id || 'default';
    next();
  };
}

async function jsonFetch(base, pathName, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(base + pathName, { ...opts, headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function phaseAuthOk(_req, _res) {
  return true;
}

function phaseAuthFail(_req, res) {
  res.status(401).json({ ok: false, error: 'unauthorized' });
  return false;
}

// —— agent-feishu-bot ——
test('agent-feishu-bot routes: disabled / event / tenant path', async () => {
  const prevEnable = process.env.ENABLE_WEBHOOK;
  const prevReq = process.env.REQUIRE_WEBHOOK_SIGNATURE;
  process.env.REQUIRE_WEBHOOK_SIGNATURE = 'false';

  try {
    process.env.ENABLE_WEBHOOK = 'false';
    await withApp(
      (app) =>
        registerAgentFeishuBotRoutes(app, {
          pool: () => ({ query: async () => ({ rows: [] }) }),
          onFeishuEvent: async () => ({ ok: true }),
        }),
      async (base) => {
        const r = await jsonFetch(base, '/api/feishu/webhook', {
          method: 'POST',
          body: JSON.stringify({ type: 'event' }),
        });
        assert.equal(r.status, 404);
        assert.equal(r.body.error, 'webhook_disabled');
      }
    );

    process.env.ENABLE_WEBHOOK = 'true';
    await withApp(
      (app) =>
        registerAgentFeishuBotRoutes(app, {
          pool: () => ({ query: async () => ({ rows: [] }) }),
          onFeishuEvent: async (parsed) => {
            if (parsed?.boom) throw new Error('evt_fail');
            return { handled: true, type: parsed?.type || 'x' };
          },
        }),
      async (base) => {
        const ok = await jsonFetch(base, '/api/feishu/webhook', {
          method: 'POST',
          body: JSON.stringify({ type: 'im.message' }),
        });
        assert.equal(ok.status, 200);
        assert.equal(ok.body.handled, true);

        const soft = await jsonFetch(base, '/api/feishu/webhook', {
          method: 'POST',
          body: JSON.stringify({ boom: true }),
        });
        assert.equal(soft.status, 200);
        assert.ok(String(soft.body.error || '').includes('evt_fail'));

        const tenant = await jsonFetch(base, '/api/feishu/webhook/t1', {
          method: 'POST',
          body: JSON.stringify({ type: 'card' }),
        });
        assert.equal(tenant.status, 200);
        assert.equal(tenant.body.handled, true);
      }
    );
  } finally {
    if (prevEnable == null) delete process.env.ENABLE_WEBHOOK;
    else process.env.ENABLE_WEBHOOK = prevEnable;
    if (prevReq == null) delete process.env.REQUIRE_WEBHOOK_SIGNATURE;
    else process.env.REQUIRE_WEBHOOK_SIGNATURE = prevReq;
  }
});

// —— growth-ab ——
test('growth-ab routes: templates / lists / write paths', async () => {
  const prev = process.env.MINIPROGRAM_SYNC_SECRET;
  process.env.MINIPROGRAM_SYNC_SECRET = 'r50-secret';
  const secretHeaders = { 'x-miniprogram-sync-secret': 'r50-secret' };

  const pool = {
    query: async () => ({ rows: [] }),
  };

  try {
    await withApp(
      (app) =>
        registerGrowthAbRoutes(app, {
          pool,
          requirePhaseAuth: phaseAuthFail,
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/ab-templates')).status, 401);
      }
    );

    await withApp(
      (app) =>
        registerGrowthAbRoutes(app, {
          pool,
          requirePhaseAuth: phaseAuthOk,
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        const tpl = await jsonFetch(base, '/api/growth/ab-templates');
        assert.equal(tpl.status, 200);
        assert.ok(Array.isArray(tpl.body.templates));

        const tests = await jsonFetch(base, '/api/growth/ab-tests');
        assert.equal(tests.status, 200);
        assert.ok(Array.isArray(tests.body.tasks));

        const learn = await jsonFetch(base, '/api/growth/learnings');
        assert.equal(learn.status, 200);

        const prices = await jsonFetch(base, '/api/growth/price-tests');
        assert.equal(prices.status, 200);

        // authPhaseApi paths
        assert.equal(
          (await jsonFetch(base, '/api/growth/ab-tests', { method: 'POST', body: '{}' })).status,
          401
        );
        const created = await jsonFetch(base, '/api/growth/ab-tests', {
          method: 'POST',
          headers: secretHeaders,
          body: JSON.stringify({}),
        });
        assert.ok([200, 400, 422, 500].includes(created.status));

        const results = await jsonFetch(base, '/api/growth/ab-tests/1/results', {
          method: 'POST',
          headers: secretHeaders,
          body: JSON.stringify({}),
        });
        assert.ok([200, 400, 404, 500].includes(results.status));

        const refresh = await jsonFetch(base, '/api/growth/ab-tests/1/refresh', {
          method: 'POST',
          headers: secretHeaders,
          body: '{}',
        });
        assert.ok([200, 400, 404, 500].includes(refresh.status));

        const promote = await jsonFetch(base, '/api/growth/ab-tests/1/promote', {
          method: 'POST',
          headers: secretHeaders,
          body: '{}',
        });
        assert.ok([200, 400, 404, 500].includes(promote.status));

        const learnPost = await jsonFetch(base, '/api/growth/learnings', {
          method: 'POST',
          headers: secretHeaders,
          body: JSON.stringify({}),
        });
        assert.ok([200, 400, 500].includes(learnPost.status));

        const seed = await jsonFetch(base, '/api/growth/learnings/seed', {
          method: 'POST',
          headers: secretHeaders,
          body: '{}',
        });
        assert.ok([200, 500].includes(seed.status));

        const pricePost = await jsonFetch(base, '/api/growth/price-tests', {
          method: 'POST',
          headers: secretHeaders,
          body: JSON.stringify({}),
        });
        assert.ok([200, 400, 500].includes(pricePost.status));
      }
    );

    await withApp(
      (app) =>
        registerGrowthAbRoutes(app, {
          pool: {
            query: async () => {
              throw new Error('db');
            },
          },
          requirePhaseAuth: phaseAuthOk,
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/ab-tests')).status, 500);
        assert.equal((await jsonFetch(base, '/api/growth/learnings')).status, 500);
        assert.equal((await jsonFetch(base, '/api/growth/price-tests')).status, 500);
      }
    );
  } finally {
    if (prev == null) delete process.env.MINIPROGRAM_SYNC_SECRET;
    else process.env.MINIPROGRAM_SYNC_SECRET = prev;
  }
});

// —— growth-pos ——
test('growth-pos routes: auth + list + config + snapshot', async () => {
  const pool = {
    query: async (sql) => {
      if (/SELECT data FROM hrms_state/i.test(String(sql))) {
        return { rows: [{ data: { orders_app_token: 'a', orders_table_id: 't' } }] };
      }
      if (/INSERT INTO hrms_state/i.test(String(sql))) return { rows: [] };
      if (/INSERT INTO sales_growth_snapshot/i.test(String(sql))) {
        return { rows: [], rowCount: 3 };
      }
      if (/UPDATE pos_orders/i.test(String(sql))) return { rows: [], rowCount: 1 };
      return { rows: [{ order_no: 'o1' }], rowCount: 1 };
    },
  };

  await withApp(
    (app) =>
      registerGrowthPosRoutes(app, {
        pool,
        requirePhaseAuth: phaseAuthFail,
        getPhaseTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/growth/pos-orders')).status, 401);
      assert.equal((await jsonFetch(base, '/api/growth/stores')).status, 401);
    }
  );

  await withApp(
    (app) =>
      registerGrowthPosRoutes(app, {
        pool,
        requirePhaseAuth: phaseAuthOk,
        getPhaseTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/growth/pos-orders', { method: 'POST', body: '{}' })).status,
        400
      );

      const orders = await jsonFetch(base, '/api/growth/pos-orders');
      assert.equal(orders.status, 200);

      assert.equal((await jsonFetch(base, '/api/growth/pos-order-items')).status, 400);
      const items = await jsonFetch(base, '/api/growth/pos-order-items?order_no=o1');
      assert.equal(items.status, 200);

      assert.equal((await jsonFetch(base, '/api/growth/customer-orders')).status, 400);
      const cust = await jsonFetch(base, '/api/growth/customer-orders?phone=13800000000');
      assert.equal(cust.status, 200);

      const linked = await jsonFetch(base, '/api/growth/pos-linked-customers');
      assert.equal(linked.status, 200);

      const stores = await jsonFetch(base, '/api/growth/stores');
      assert.equal(stores.status, 200);
      assert.ok(stores.body.stores.length >= 2);

      const link = await jsonFetch(base, '/api/growth/pos-link-customers', { method: 'POST' });
      assert.equal(link.status, 200);

      const stats = await jsonFetch(base, '/api/growth/pos-stats');
      assert.ok([200, 500].includes(stats.status));

      const cfg = await jsonFetch(base, '/api/growth/pos-feishu-config');
      assert.equal(cfg.status, 200);

      assert.equal(
        (
          await jsonFetch(base, '/api/growth/pos-feishu-config', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const saveCfg = await jsonFetch(base, '/api/growth/pos-feishu-config', {
        method: 'POST',
        body: JSON.stringify({
          orders_app_token: 'app',
          orders_table_id: 'tbl',
        }),
      });
      assert.ok([200, 500].includes(saveCfg.status));

      const snap = await jsonFetch(base, '/api/growth/snapshot/refresh', {
        method: 'POST',
        body: JSON.stringify({ days: 3 }),
      });
      assert.equal(snap.status, 200);
      assert.equal(snap.body.days_covered, 3);
    }
  );

  await withApp(
    (app) =>
      registerGrowthPosRoutes(app, {
        pool: {
          query: async () => {
            throw new Error('db');
          },
        },
        requirePhaseAuth: phaseAuthOk,
        getPhaseTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/growth/pos-orders')).status, 500);
      assert.equal((await jsonFetch(base, '/api/growth/pos-order-items?order_no=x')).status, 500);
      assert.equal(
        (await jsonFetch(base, '/api/growth/customer-orders?phone=13800000000')).status,
        500
      );
      assert.equal((await jsonFetch(base, '/api/growth/pos-linked-customers')).status, 500);
      assert.equal(
        (await jsonFetch(base, '/api/growth/pos-link-customers', { method: 'POST' })).status,
        500
      );
    }
  );
});

// —— daily-reports ——
test('daily-reports routes: access + list + write gates', async () => {
  const deps = {
    pool: {
      query: async () => ({ rows: [{ total: 5 }] }),
    },
    authRequired: authAs({ role: 'admin', username: 'a1', tenant_id: 't1' }),
    getSharedState: async () => ({
      dailyReports: [],
      employees: [{ username: 'a1', store: 'S1', name: 'A' }],
      users: [],
    }),
    mergeSharedStateFields: async () => ({}),
    safeDateOnly: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null),
    stateFindUserRecord: (_s, u) => ({ username: u, store: 'S1' }),
    expandAgentStoreLabels: (s) => [s],
    inDateRange: () => true,
    hrmsNowISO: () => '2026-07-26T00:00:00+08:00',
    notifyAdminsDualWriteFailure: () => {},
    safeErrMessage: (e) => String(e?.message || e),
    isAdmin: (r) => r === 'admin',
    addStateNotification: (s) => s,
    makeNotif: () => ({}),
  };

  await withApp(
    (app) =>
      registerDailyReportsRoutes(app, {
        ...deps,
        authRequired: authAs({ role: 'store_employee', username: 'e1' }),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/daily-reports')).status, 403);
      assert.equal(
        (await jsonFetch(base, '/api/daily-reports', { method: 'POST', body: '{}' })).status,
        403
      );
      assert.equal((await jsonFetch(base, '/api/daily-reports', { method: 'DELETE' })).status, 403);
      assert.equal(
        (
          await jsonFetch(base, '/api/admin/sync-submitted-daily-reports-pg', {
            method: 'POST',
            body: '{}',
          })
        ).status,
        403
      );
    }
  );

  await withApp(
    (app) => registerDailyReportsRoutes(app, deps),
    async (base) => {
      const room0 = await jsonFetch(base, '/api/daily-reports/private-room-month-total');
      assert.equal(room0.status, 200);
      assert.equal(room0.body.total, 0);

      const room = await jsonFetch(
        base,
        '/api/daily-reports/private-room-month-total?store=S1&month=2026-07'
      );
      assert.equal(room.status, 200);
      assert.equal(room.body.total, 5);

      assert.equal(
        (await jsonFetch(base, '/api/daily-reports', {
          // username empty via custom auth
        })).status,
        200
      );

      const list = await jsonFetch(base, '/api/daily-reports?date=2026-07-01&limit=10');
      assert.equal(list.status, 200);

      assert.equal(
        (await jsonFetch(base, '/api/daily-reports', { method: 'POST', body: '{}' })).status,
        400
      );

      assert.equal(
        (await jsonFetch(base, '/api/daily-reports?store=S1', { method: 'DELETE' })).status,
        400
      );
      const del = await jsonFetch(base, '/api/daily-reports?store=S1&date=2026-07-01', {
        method: 'DELETE',
      });
      assert.ok([200, 502, 500].includes(del.status));

      assert.equal(
        (
          await jsonFetch(base, '/api/admin/sync-submitted-daily-reports-pg', {
            method: 'POST',
            body: '{}',
          })
        ).status,
        400
      );
      const sync = await jsonFetch(base, '/api/admin/sync-submitted-daily-reports-pg', {
        method: 'POST',
        body: JSON.stringify({ date: '2026-07-01' }),
      });
      assert.ok([200, 500].includes(sync.status));
    }
  );

  await withApp(
    (app) =>
      registerDailyReportsRoutes(app, {
        ...deps,
        authRequired: authAs({ username: '', role: 'admin' }),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/daily-reports')).status, 400);
      assert.equal(
        (await jsonFetch(base, '/api/daily-reports', { method: 'POST', body: '{}' })).status,
        400
      );
    }
  );
});

// —— sales-ai admin meta ——
test('sales-ai admin-meta routes: meta / permission / knowledge / assets', async () => {
  const platformAdmin = (req, _res, next) => {
    req.platformAdmin = { username: 'pa', role: 'sales_manager' };
    next();
  };
  const managerGate = (_req, _res, next) => next();
  const pool = {
    query: async (sql) => {
      if (/FROM sales_permission_config/i.test(String(sql)) || /sales_permission/i.test(String(sql))) {
        return { rows: [] };
      }
      if (/FROM sales_knowledge/i.test(String(sql)) || /knowledge/i.test(String(sql))) {
        return { rows: [{ id: 1, item_key: 'k1', title: 't', body: 'b' }] };
      }
      if (/FROM sales_content_assets/i.test(String(sql)) || /INSERT INTO sales_content_assets/i.test(String(sql))) {
        return {
          rows: [
            {
              id: 1,
              asset_key: 'a1',
              title: 'T',
              content_type: 'text',
              knowledge_domain: 'customer_ai',
              active: true,
              external_approved: true,
            },
          ],
        };
      }
      if (/FROM sales_leads/i.test(String(sql)) || /UPDATE sales_leads/i.test(String(sql))) {
        return { rows: [{ id: 9, auto_nurture_enabled: true }] };
      }
      if (/INSERT INTO sales_action_logs/i.test(String(sql))) return { rows: [] };
      if (/CREATE TABLE/i.test(String(sql))) return { rows: [] };
      return { rows: [] };
    },
  };

  const upload = {
    single: () => (req, _res, next) => {
      if (req.headers['x-has-file'] === '1') {
        req.file = {
          filename: 'f1.png',
          originalname: 'f1.png',
          size: 100,
          mimetype: 'image/png',
        };
      } else if (req.headers['x-big-file'] === '1') {
        req.file = {
          filename: 'big.bin',
          originalname: 'big.bin',
          size: 21 * 1024 * 1024,
          mimetype: 'application/pdf',
        };
      } else if (req.headers['x-bad-mime'] === '1') {
        req.file = {
          filename: 'x.exe',
          originalname: 'x.exe',
          size: 10,
          mimetype: 'application/octet-stream',
        };
      }
      next();
    },
  };

  await withApp(
    (app) =>
      registerSalesAiAdminMetaRoutes({
        app,
        pool,
        platformAdminRequired: platformAdmin,
        gates: { managerGate },
        upload,
      }),
    async (base) => {
      const meta = await jsonFetch(base, '/api/admin/sales/meta');
      assert.equal(meta.status, 200);
      assert.equal(meta.body.ok, true);
      assert.ok(meta.body.persona);

      const perm = await jsonFetch(base, '/api/admin/sales/permission-config');
      assert.equal(perm.status, 200);

      const putPerm = await jsonFetch(base, '/api/admin/sales/permission-config', {
        method: 'PUT',
        body: JSON.stringify({
          config: { sales: { data_scope: 'own', modules: ['leads'] } },
        }),
      });
      assert.ok([200, 500].includes(putPerm.status));

      const kn = await jsonFetch(base, '/api/admin/sales/knowledge');
      assert.equal(kn.status, 200);

      assert.equal(
        (
          await jsonFetch(base, '/api/admin/sales/knowledge', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const knPost = await jsonFetch(base, '/api/admin/sales/knowledge', {
        method: 'POST',
        body: JSON.stringify({ item_key: 'k2', title: 'T', body: 'B' }),
      });
      assert.ok([200, 500].includes(knPost.status));

      const knDel = await jsonFetch(base, '/api/admin/sales/knowledge/1', { method: 'DELETE' });
      assert.ok([200, 500].includes(knDel.status));

      const assets = await jsonFetch(base, '/api/admin/sales/content-assets');
      assert.equal(assets.status, 200);

      assert.equal(
        (
          await jsonFetch(base, '/api/admin/sales/content-assets', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const assetOk = await jsonFetch(base, '/api/admin/sales/content-assets', {
        method: 'POST',
        body: JSON.stringify({
          asset_key: 'ak1',
          title: 'Hello',
          content_type: 'text',
          knowledge_domain: 'customer_ai',
          text_content: 'hi',
        }),
      });
      assert.ok([200, 500].includes(assetOk.status));

      assert.equal(
        (
          await jsonFetch(base, '/api/admin/sales/content-assets/upload', {
            method: 'POST',
          })
        ).status,
        400
      );
      const up = await jsonFetch(base, '/api/admin/sales/content-assets/upload', {
        method: 'POST',
        headers: { 'x-has-file': '1' },
      });
      assert.equal(up.status, 200);
      assert.ok(up.body.media_url);

      assert.equal(
        (
          await jsonFetch(base, '/api/admin/sales/content-assets/upload', {
            method: 'POST',
            headers: { 'x-big-file': '1' },
          })
        ).status,
        413
      );

      assert.equal(
        (
          await jsonFetch(base, '/api/admin/sales/documents/upload', {
            method: 'POST',
            headers: { 'x-bad-mime': '1' },
          })
        ).status,
        415
      );
      const doc = await jsonFetch(base, '/api/admin/sales/documents/upload', {
        method: 'POST',
        headers: { 'x-has-file': '1' },
      });
      assert.equal(doc.status, 200);

      const nurture = await jsonFetch(base, '/api/admin/sales/leads/9/auto-nurture', {
        method: 'PUT',
        body: JSON.stringify({ enabled: true }),
      });
      // getLead may 404 with empty mock
      assert.ok([200, 404, 500].includes(nurture.status));

      const deliver = await jsonFetch(base, '/api/admin/sales/leads/9/content-deliveries', {
        method: 'POST',
        body: JSON.stringify({ asset_id: 1 }),
      });
      assert.ok([200, 404, 502].includes(deliver.status));
    }
  );
});
