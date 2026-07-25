/**
 * R44：薄 routes（BI/dedup/notif/diagnosis/gm/duty/rag/calendar）+
 * growth-winback/service 冲高挂 extracted 地板。
 */
import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerReportsBiRoutes } from '../domains/reports/routes-bi.js';
import { registerReportsRoutes } from '../domains/reports/routes.js';
import { registerDedupRoutes } from '../domains/dedup/routes.js';
import { registerNotificationsWriteRoutes } from '../domains/notifications/routes.js';
import { registerDiagnosisFeedbackRoutes } from '../domains/diagnosis/routes.js';
import { registerGmMailboxRoutes } from '../domains/gm-mailbox/routes.js';
import { registerStoreDutyBindingsRoutes } from '../domains/store-duty-bindings/routes.js';
import { registerRagRoutes } from '../domains/rag/routes.js';
import { registerGrowthContentCalendarRoutes } from '../domains/growth-content-calendar/routes.js';
import { registerTenantPlatformRoutes } from '../domains/tenant-platform/routes.js';
import {
  sendWinbackSms,
  previewWinback,
  launchWinback,
  listPendingJobs,
  reportJobResult,
  listJobs,
  listTouchRules,
  upsertTouchRule,
  approveTouchRule,
  unapproveTouchRule,
  touchRulesStats,
  touchRulesAudience,
} from '../domains/growth-winback/service.js';

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

async function jsonFetch(base, path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(base + path, { ...opts, headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function fakeApp() {
  const app = {
    get() { return app; },
    post() { return app; },
    put() { return app; },
    patch() { return app; },
    delete() { return app; },
    use() { return app; },
  };
  return app;
}

function passthroughTenantContext() {
  return { run: async (_tid, fn) => fn() };
}

function baseWinbackCtx(overrides = {}) {
  return {
    pool: { async query() { return { rows: [] }; } },
    sendAliyunSms: async () => ({ provider_msg_id: 'm1', raw: {} }),
    tenantContext: passthroughTenantContext(),
    resolveTenantIdForStore: async () => 'default',
    pickWinbackTemplateByStore: () => 'SMS_WB',
    freqDaysEnv: (_k, d) => d,
    globalSmsCapped: async () => null,
    isPhoneSuppressed: async () => false,
    upsertCustomer: async () => ({ id: 1 }),
    upsertDeliveryLog: async () => {},
    insertGrowthEvent: async () => {},
    handleSmsFailure: async () => {},
    inSmsQuietHours: () => false,
    CAMPAIGN_TYPES: {
      VIP: { vars: ['value', 'date', 'code'] },
      GIFT: { vars: ['date', 'code'] },
    },
    getTouchRulesAudience: async () => ({ rules: [], total: 0 }),
    ...overrides,
  };
}

const smsBody = {
  phone: '13800138000',
  store_id: 's1',
  coupon_code: 'C1',
  value_yuan: 20,
  valid_until: '2026-08-01',
};

// —— reports BI ——
test('reports BI routes: admin gate / ok / 500 / missing username', async () => {
  await withApp(
    (app) =>
      registerReportsBiRoutes(app, {
        authRequired: authAs({ role: 'store_employee', username: 'e' }),
        sendWeeklyReports: async () => {},
        sendMonthlyReports: async () => {},
        sendTestReportsToUser: async () => ({ ok: true }),
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/reports/bi/trigger-weekly', { method: 'POST', body: '{}' })).status,
        403
      );
    }
  );

  await withApp(
    (app) =>
      registerReportsBiRoutes(app, {
        authRequired: authAs({ role: 'admin', username: 'a', tenant_id: 't1' }),
        sendWeeklyReports: async (tid) => { assert.equal(tid, 't1'); },
        sendMonthlyReports: async () => {},
        sendTestReportsToUser: async (u) => ({ ok: true, username: u }),
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/reports/bi/trigger-weekly', { method: 'POST', body: '{}' })).status,
        200
      );
      assert.equal(
        (await jsonFetch(base, '/api/reports/bi/trigger-monthly', { method: 'POST', body: '{}' })).status,
        200
      );
      assert.equal(
        (await jsonFetch(base, '/api/reports/bi/test-send', { method: 'POST', body: '{}' })).status,
        400
      );
      const t = await jsonFetch(base, '/api/reports/bi/test-send', {
        method: 'POST',
        body: JSON.stringify({ username: 'u1' }),
      });
      assert.equal(t.status, 200);
      assert.equal(t.body.username, 'u1');
    }
  );

  await withApp(
    (app) =>
      registerReportsBiRoutes(app, {
        authRequired: authAs({ role: 'admin', username: 'a' }),
        sendWeeklyReports: async () => { throw new Error('x'); },
        sendMonthlyReports: async () => { throw new Error('y'); },
        sendTestReportsToUser: async () => { throw new Error('z'); },
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/reports/bi/trigger-weekly', { method: 'POST', body: '{}' })).status,
        500
      );
      assert.equal(
        (await jsonFetch(base, '/api/reports/bi/trigger-monthly', { method: 'POST', body: '{}' })).status,
        500
      );
      assert.equal(
        (await jsonFetch(base, '/api/reports/bi/test-send', {
          method: 'POST',
          body: JSON.stringify({ username: 'u' }),
        })).status,
        500
      );
    }
  );
});

// —— dedup ——
test('dedup routes: stats + cleanup', async () => {
  await withApp(
    (app) =>
      registerDedupRoutes(app, authAs({ role: 'store_employee' }), {
        pool: { query: async () => ({ rows: [{ cnt: 0 }], rowCount: 0 }) },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/dedup/stats')).status, 403);
      assert.equal(
        (await jsonFetch(base, '/api/dedup/cleanup', { method: 'POST', body: '{}' })).status,
        403
      );
    }
  );

  let n = 0;
  await withApp(
    (app) =>
      registerDedupRoutes(app, authAs({ role: 'admin', tenant_id: 't1' }), {
        pool: {
          query: async () => {
            n += 1;
            return { rows: [{ cnt: String(n) }], rowCount: 2 };
          },
        },
      }),
    async (base) => {
      const s = await jsonFetch(base, '/api/dedup/stats');
      assert.equal(s.status, 200);
      assert.equal(s.body.ok, true);
      assert.ok('agent_messages_dup_groups' in s.body.tables);
      const c = await jsonFetch(base, '/api/dedup/cleanup', { method: 'POST', body: '{}' });
      assert.equal(c.status, 200);
      assert.equal(c.body.deleted, 2);
    }
  );

  await withApp(
    (app) =>
      registerDedupRoutes(app, authAs({ role: 'admin' }), {
        pool: { query: async () => { throw new Error('db'); } },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/dedup/stats')).status, 500);
      assert.equal(
        (await jsonFetch(base, '/api/dedup/cleanup', { method: 'POST', body: '{}' })).status,
        500
      );
    }
  );
});

// —— notifications ——
test('notifications write routes: delete + batch', async () => {
  await withApp(
    (app) =>
      registerNotificationsWriteRoutes(app, authAs({ role: 'store_employee' }), {
        pool: { query: async () => ({ rowCount: 0, rows: [] }) },
        resolveTenantIdDefault: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/notifications/1', { method: 'DELETE' })).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerNotificationsWriteRoutes(app, authAs({ role: 'admin' }), {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('DELETE')) return { rowCount: 0, rows: [] };
            return { rows: [{ id: 9 }], rowCount: 1 };
          },
        },
        resolveTenantIdDefault: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/notifications/%20', { method: 'DELETE' })).status, 400);
      const d0 = await jsonFetch(base, '/api/notifications/n1', { method: 'DELETE' });
      assert.equal(d0.status, 200);
      assert.equal(d0.body.deleted, 0);

      assert.equal(
        (await jsonFetch(base, '/api/notifications/batch', {
          method: 'POST',
          body: JSON.stringify({ notifications: [] }),
        })).status,
        400
      );
      const batch = await jsonFetch(base, '/api/notifications/batch', {
        method: 'POST',
        body: JSON.stringify({
          notifications: [
            { targetUser: 'u1', title: 'T', message: 'M' },
            { targetUser: '', title: 'skip' },
          ],
        }),
      });
      assert.equal(batch.status, 200);
      assert.deepEqual(batch.body.ids, [9]);
    }
  );

  await withApp(
    (app) =>
      registerNotificationsWriteRoutes(app, authAs({ role: 'admin' }), {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('DELETE')) return { rowCount: 1, rows: [] };
            throw new Error('db');
          },
        },
        resolveTenantIdDefault: () => 'default',
      }),
    async (base) => {
      const d = await jsonFetch(base, '/api/notifications/n1', { method: 'DELETE' });
      assert.equal(d.status, 200);
      assert.equal(d.body.deleted, 1);
      assert.equal(
        (await jsonFetch(base, '/api/notifications/batch', {
          method: 'POST',
          body: JSON.stringify({ notifications: [{ targetUser: 'u', title: 't' }] }),
        })).status,
        500
      );
    }
  );

  await withApp(
    (app) =>
      registerNotificationsWriteRoutes(app, authAs({ role: 'admin' }), {
        pool: { query: async () => { throw new Error('db'); } },
        resolveTenantIdDefault: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/notifications/n1', { method: 'DELETE' })).status, 500);
    }
  );
});

// —— diagnosis ——
test('diagnosis feedback + stats routes', async () => {
  await withApp(
    (app) =>
      registerDiagnosisFeedbackRoutes(app, authAs({ role: 'store_employee', username: 'U1' }), {
        pool: { query: async () => ({ rows: [] }) },
        recordAiFeedback: async () => {},
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/agent/diagnosis-feedback', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );
      assert.equal(
        (await jsonFetch(base, '/api/agent/diagnosis-feedback', {
          method: 'POST',
          body: JSON.stringify({ task_id: 't', feedback: 2 }),
        })).status,
        400
      );
      assert.equal((await jsonFetch(base, '/api/admin/diagnosis-stats')).status, 403);
    }
  );

  let feedbackCalls = 0;
  await withApp(
    (app) =>
      registerDiagnosisFeedbackRoutes(app, authAs({ role: 'admin', username: 'Admin', tenant_id: 't1' }), {
        pool: {
          query: async (sql, params) => {
            if (String(sql).includes('UPDATE diagnosis_feedback')) {
              if (params[2] === 'missing') return { rows: [] };
              return {
                rows: [{
                  id: 1,
                  trace_id: 'tr1',
                  diagnosis: 'd',
                  query_text: 'q',
                }],
              };
            }
            return { rows: [{ total: '1', rated: '1', like_rate_pct: 100, avg_char_count: 10, avg_metric_count: 2 }] };
          },
        },
        recordAiFeedback: async () => { feedbackCalls += 1; },
      }),
    async (base) => {
      const ok = await jsonFetch(base, '/api/agent/diagnosis-feedback', {
        method: 'POST',
        body: JSON.stringify({ task_id: 't1', feedback: 1, feedback_note: 'good' }),
      });
      assert.equal(ok.status, 200);
      assert.equal(feedbackCalls, 1);

      assert.equal(
        (await jsonFetch(base, '/api/agent/diagnosis-feedback', {
          method: 'POST',
          body: JSON.stringify({ task_id: 'missing', feedback: 0 }),
        })).status,
        404
      );

      const st = await jsonFetch(base, '/api/admin/diagnosis-stats');
      assert.equal(st.status, 200);
      assert.equal(st.body.total, '1');
    }
  );

  await withApp(
    (app) =>
      registerDiagnosisFeedbackRoutes(app, authAs({ role: 'hq_manager', username: 'h' }), {
        pool: { query: async () => { throw new Error('db'); } },
        recordAiFeedback: async () => {},
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/agent/diagnosis-feedback', {
          method: 'POST',
          body: JSON.stringify({ task_id: 't', feedback: 1 }),
        })).status,
        500
      );
      assert.equal((await jsonFetch(base, '/api/admin/diagnosis-stats')).status, 500);
    }
  );
});

// —— gm-mailbox ——
test('gm-mailbox routes', async () => {
  let saved = null;
  await withApp(
    (app) =>
      registerGmMailboxRoutes(app, authAs({ username: '', role: 'store_employee' }), {
        getSharedState: async () => ({}),
        saveSharedState: async () => {},
        pickHqManagerUsername: async () => null,
        pickAdminUsername: async () => 'admin',
        addStateNotification: (s) => s,
        makeNotif: (u, t, m) => ({ u, t, m }),
        uniqUsernames: (xs) => [...new Set(xs.filter(Boolean))],
        hrmsNowISO: () => '2026-07-26T00:00:00.000Z',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/gm-mailbox', { method: 'POST', body: '{}' })).status,
        400
      );
    }
  );

  await withApp(
    (app) =>
      registerGmMailboxRoutes(app, authAs({ username: 'e1', role: 'store_employee' }), {
        getSharedState: async () => ({ gmMailbox: [] }),
        saveSharedState: async (s) => { saved = s; },
        pickHqManagerUsername: async () => 'hq',
        pickAdminUsername: async () => 'admin',
        addStateNotification: (s, n) => ({
          ...s,
          notifications: [...(s.notifications || []), n],
        }),
        makeNotif: (u, title, msg, meta) => ({ target: u, title, msg, meta }),
        uniqUsernames: (xs) => [...new Set(xs.filter(Boolean))],
        hrmsNowISO: () => '2026-07-26T00:00:00.000Z',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/gm-mailbox', {
          method: 'POST',
          body: JSON.stringify({ content: 'hi' }),
        })).status,
        400
      );
      const ok = await jsonFetch(base, '/api/gm-mailbox', {
        method: 'POST',
        body: JSON.stringify({ content: 'hello world message' }),
      });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.ok, true);
      assert.ok(saved.gmMailbox.length === 1);
      assert.ok((saved.notifications || []).length >= 1);
    }
  );

  await withApp(
    (app) =>
      registerGmMailboxRoutes(app, authAs({ username: 'e1' }), {
        getSharedState: async () => { throw new Error('x'); },
        saveSharedState: async () => {},
        pickHqManagerUsername: async () => null,
        pickAdminUsername: async () => null,
        addStateNotification: (s) => s,
        makeNotif: () => ({}),
        uniqUsernames: () => [],
        hrmsNowISO: () => 't',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/gm-mailbox', {
          method: 'POST',
          body: JSON.stringify({ content: 'long enough content' }),
        })).status,
        500
      );
    }
  );
});

// —— store-duty-bindings ——
test('store-duty-bindings routes', async () => {
  const pool = {
    query: async (sql, params) => {
      const s = String(sql);
      if (s.includes('CREATE') || s.includes('ensure') || s.includes('information_schema')) {
        return { rows: [] };
      }
      if (s.includes('SELECT id, username')) return { rows: [{ id: 1, username: 'u', store: 's' }] };
      if (s.includes('INSERT INTO store_duty_bindings')) {
        return { rows: [{ id: 2, username: params[0], store: params[1] }] };
      }
      if (s.includes('DELETE FROM store_duty_bindings') || s.includes('DELETE')) {
        return { rowCount: params?.[0] === 99 ? 0 : 1, rows: [] };
      }
      if (s.includes('UPDATE store_duty_bindings')) return { rows: [], rowCount: 0 };
      return { rows: [] };
    },
  };

  await withApp(
    (app) => registerStoreDutyBindingsRoutes(app, authAs({ role: 'store_employee' }), { pool }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/admin/store-duty-bindings')).status, 403);
    }
  );

  await withApp(
    (app) => registerStoreDutyBindingsRoutes(app, authAs({ role: 'admin' }), { pool }),
    async (base) => {
      const list = await jsonFetch(base, '/api/admin/store-duty-bindings');
      assert.equal(list.status, 200);
      assert.equal(list.body.items.length, 1);

      assert.equal(
        (await jsonFetch(base, '/api/admin/store-duty-bindings', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );

      const created = await jsonFetch(base, '/api/admin/store-duty-bindings', {
        method: 'POST',
        body: JSON.stringify({ username: 'u2', store: '洪潮', is_primary_store: true }),
      });
      assert.equal(created.status, 200);
      assert.equal(created.body.item.username, 'u2');

      assert.equal(
        (await jsonFetch(base, '/api/admin/store-duty-bindings/bad', { method: 'DELETE' })).status,
        400
      );
      assert.equal(
        (await jsonFetch(base, '/api/admin/store-duty-bindings/99', { method: 'DELETE' })).status,
        404
      );
      assert.equal(
        (await jsonFetch(base, '/api/admin/store-duty-bindings/2', { method: 'DELETE' })).status,
        200
      );
    }
  );

  await withApp(
    (app) =>
      registerStoreDutyBindingsRoutes(app, authAs({ role: 'admin' }), {
        pool: { query: async () => { throw new Error('db'); } },
      }),
    async (base) => {
      // ensureReady swallows ensure failure; listBindings then throws → 500
      assert.equal((await jsonFetch(base, '/api/admin/store-duty-bindings')).status, 500);
    }
  );
});

// —— rag ——
test('rag routes: stats / query / multi-query', async () => {
  await withApp(
    (app) =>
      registerRagRoutes(app, authAs({ role: 'admin', username: 'admin' }), {
        getSharedState: async () => ({
          employees: [{ username: 'admin', store: '总部', position: '经理' }],
          users: [],
        }),
        ragStats: async () => ({ docs: 3 }),
        ragQuery: async (q) => ({ ok: true, q: q.query }),
        ragMultiQuery: async (q) => ({ ok: true, n: q.queries.length }),
      }),
    async (base) => {
      const st = await jsonFetch(base, '/api/rag/stats');
      assert.equal(st.status, 200);
      assert.equal(st.body.docs, 3);

      assert.equal(
        (await jsonFetch(base, '/api/rag/query', { method: 'POST', body: '{}' })).status,
        400
      );
      const q = await jsonFetch(base, '/api/rag/query', {
        method: 'POST',
        body: JSON.stringify({ query: 'hello' }),
      });
      assert.equal(q.status, 200);
      assert.equal(q.body.q, 'hello');

      assert.equal(
        (await jsonFetch(base, '/api/rag/multi-query', { method: 'POST', body: '{}' })).status,
        400
      );
      const mq = await jsonFetch(base, '/api/rag/multi-query', {
        method: 'POST',
        body: JSON.stringify({ queries: ['a', 'b'] }),
      });
      assert.equal(mq.status, 200);
      assert.equal(mq.body.n, 2);
    }
  );
});

// —— content-calendar ——
test('growth content-calendar routes', async () => {
  await withApp(
    (app) =>
      registerGrowthContentCalendarRoutes(app, {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('INSERT')) return { rows: [{ item_id: 'i1' }] };
            if (String(sql).includes('GROUP BY')) return { rows: [{ channel: 'xhs', total_items: 1 }] };
            return { rows: [{ item_id: 'i1' }] };
          },
        },
        requirePhaseAuth: () => true,
        getPhaseTenantId: () => 'default',
      }),
    async (base) => {
      const post = await jsonFetch(base, '/api/growth/content-calendar', {
        method: 'POST',
        body: JSON.stringify({ item_id: 'i1', title: 'T', channel: 'xhs' }),
      });
      assert.equal(post.status, 200);
      assert.equal(post.body.ok, true);

      assert.equal((await jsonFetch(base, '/api/growth/content-calendar')).status, 200);
      assert.equal((await jsonFetch(base, '/api/growth/content-calendar/upcoming')).status, 200);
      const fx = await jsonFetch(base, '/api/growth/channel-effects?days=7');
      assert.equal(fx.status, 200);
      assert.equal(fx.body.effects.length, 1);
    }
  );

  await withApp(
    (app) =>
      registerGrowthContentCalendarRoutes(app, {
        pool: { query: async () => { throw new Error('db'); } },
        requirePhaseAuth: (_req, res) => {
          res.status(401).json({ error: 'unauthorized' });
          return false;
        },
        getPhaseTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/growth/content-calendar')).status, 401);
    }
  );

  await withApp(
    (app) =>
      registerGrowthContentCalendarRoutes(app, {
        pool: { query: async () => { throw new Error('db'); } },
        requirePhaseAuth: () => true,
        getPhaseTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/growth/content-calendar', {
          method: 'POST',
          body: '{}',
        })).status,
        500
      );
      assert.equal((await jsonFetch(base, '/api/growth/content-calendar')).status, 500);
      assert.equal((await jsonFetch(base, '/api/growth/content-calendar/upcoming')).status, 500);
      assert.equal((await jsonFetch(base, '/api/growth/channel-effects')).status, 500);
    }
  );
});

// —— composers ——
test('reports + tenant-platform route composers', () => {
  const noop = (_req, _res, next) => next && next();
  const depsReports = {
    pool: { query: async () => ({ rows: [] }) },
    safeMonthOnly: (m) => m,
    resolveAgentCanonicalStore: (s) => s,
    getSharedState: async () => ({}),
    authRequired: noop,
  };
  registerReportsRoutes(fakeApp(), depsReports);

  const depsPlat = {
    pool: { query: async () => ({ rows: [] }) },
    platformAdminRequired: noop,
    platformAdminSessionRequired: noop,
    loginRateLimit: noop,
    PLATFORM_ADMIN_SECRET: 'x',
    PLATFORM_ADMIN_JWT_SECRET: 'y',
    upload: { single: () => noop },
    recordUploadOwnership: async () => {},
    tenantIntegrationEncryptionKey: 'k',
    requiredTenantFeishuTableKeys: [],
  };
  registerTenantPlatformRoutes(fakeApp(), depsPlat);
  assert.ok(true);
});

// —— growth-winback/service ——
test('winback: sendSms branches + launch/preview/jobs', async () => {
  assert.equal(
    (await sendWinbackSms(baseWinbackCtx(), { ...smsBody, value_yuan: 0 })).body.error,
    'missing_value'
  );
  assert.equal(
    (await sendWinbackSms(baseWinbackCtx(), { ...smsBody, valid_until: '' })).body.error,
    'missing_valid_until'
  );
  assert.equal(
    (await sendWinbackSms(baseWinbackCtx({ pickWinbackTemplateByStore: () => '' }), smsBody)).status,
    503
  );
  assert.equal(
    (await sendWinbackSms(baseWinbackCtx({ globalSmsCapped: async () => 7 }), smsBody)).body.reason,
    'global_frequency_capped'
  );
  assert.equal(
    (await sendWinbackSms(baseWinbackCtx({ isPhoneSuppressed: async () => true }), smsBody)).body.reason,
    'suppressed'
  );

  const sent = await sendWinbackSms(baseWinbackCtx({ freqDaysEnv: () => 0 }), smsBody);
  assert.equal(sent.body.ok, true);
  assert.equal(sent.body.provider_msg_id, 'm1');

  const failed = await sendWinbackSms(
    baseWinbackCtx({
      freqDaysEnv: () => 0,
      sendAliyunSms: async () => { throw new Error('down'); },
    }),
    smsBody
  );
  assert.equal(failed.status, 502);

  const preview = await previewWinback(
    baseWinbackCtx({
      pool: {
        async query() {
          return {
            rows: [
              { phone: '13800138000', balance_fen: 500, last_consume_date: null, sendable: true },
              { phone: '13900139000', balance_fen: 100, last_consume_date: '2026-01-01', sendable: false },
            ],
          };
        },
      },
    }),
    { tenantId: 'default', store_id: 's1', dormant_days: 14, min_balance_yuan: 1, freq_days: 7 }
  );
  assert.equal(preview.body.sendable_count, 1);
  assert.equal(preview.body.capped_count, 1);
  assert.equal(preview.body.sample[0].phone, '138****8000');

  assert.equal(
    (await launchWinback(baseWinbackCtx(), {}, 'default')).body.error,
    'missing_store_id'
  );
  assert.equal(
    (await launchWinback(baseWinbackCtx(), { store_id: 's1', value_yuan: 0 }, 'default')).body.error,
    'missing_value'
  );

  const emptyLaunch = await launchWinback(
    baseWinbackCtx(),
    { store_id: 's1', value_yuan: 10 },
    'default'
  );
  assert.equal(emptyLaunch.body.target_count, 0);

  const launched = await launchWinback(
    baseWinbackCtx({
      pool: {
        async query(sql) {
          if (String(sql).includes('INSERT INTO growth_campaign_jobs')) {
            return { rows: [{ id: 11 }] };
          }
          return { rows: [{ phone: '138', member_name: 'A', card_no: 'C1' }] };
        },
      },
    }),
    { store_id: 's1', value_yuan: 10, operator: 'op' },
    'default'
  );
  assert.equal(launched.body.job_id, 11);
  assert.equal(launched.body.target_count, 1);

  const quiet = await listPendingJobs(baseWinbackCtx({ inSmsQuietHours: () => true }), 'default');
  assert.equal(quiet.body.quiet_hours, true);

  const pending = await listPendingJobs(baseWinbackCtx({
    pool: {
      async query(sql) {
        if (String(sql).includes('RETURNING')) {
          return { rows: [{ id: 1, campaign_id: 'c', store_id: 's1' }] };
        }
        return { rows: [] };
      },
    },
  }), 'default');
  assert.equal(pending.body.job?.id, 1);

  assert.equal((await reportJobResult(baseWinbackCtx(), {}, 'default')).body.error, 'missing_job_id');
  assert.equal(
    (await reportJobResult(baseWinbackCtx(), { job_id: 1, sent: 2, failed: 1, status: 'done' }, 'default')).body.ok,
    true
  );
  assert.equal(
    (await reportJobResult(baseWinbackCtx(), { job_id: 1, sent: 0, failed: 2 }, 'default')).body.ok,
    true
  );
  assert.equal(
    (await reportJobResult(baseWinbackCtx(), { job_id: 1, sent: 1, failed: 1, status: 'pending' }, 'default')).body.ok,
    true
  );

  const jobs = await listJobs(
    baseWinbackCtx({
      pool: { async query() { return { rows: [{ id: 1 }] }; } },
    }),
    { tenantId: 'default', limit: 5 }
  );
  assert.equal(jobs.body.jobs.length, 1);
});

test('winback: touch rules CRUD + stats + audience', async () => {
  const listed = await listTouchRules(
    baseWinbackCtx({
      pool: { async query() { return { rows: [{ rule_key: 'r1' }] }; } },
    }),
    'default'
  );
  assert.equal(listed.body.rules.length, 1);

  const upserted = await upsertTouchRule(
    baseWinbackCtx({
      pool: {
        async query(sql) {
          if (String(sql).includes('SELECT criteria')) {
            return {
              rows: [{
                criteria: { a: 1 },
                action_payload: {},
                action_type: 'send_message',
              }],
            };
          }
          return { rows: [{ rule_key: 'r1', name: 'R' }] };
        },
      },
    }),
    { rule_key: 'r1', name: 'R', criteria: { b: 2 }, enabled: true },
    'default'
  );
  assert.equal(upserted.body.ok, true);

  // keep approval when criteria unchanged
  const keep = await upsertTouchRule(
    baseWinbackCtx({
      pool: {
        async query(sql) {
          if (String(sql).includes('SELECT criteria')) {
            return {
              rows: [{
                criteria: { a: 1 },
                action_payload: { x: 1 },
                action_type: 'send_message',
              }],
            };
          }
          return { rows: [{ rule_key: 'r1' }] };
        },
      },
    }),
    {
      rule_key: 'r1',
      criteria: { a: 1 },
      action_payload: { x: 1 },
      action_type: 'send_message',
    },
    'default'
  );
  assert.equal(keep.body.ok, true);

  const prevRefresh = globalThis.__refreshGrowthAudience;
  let refreshed = 0;
  globalThis.__refreshGrowthAudience = () => { refreshed += 1; };
  try {
    await upsertTouchRule(
      baseWinbackCtx({
        pool: {
          async query(sql) {
            if (String(sql).includes('SELECT criteria')) return { rows: [] };
            return { rows: [{ rule_key: 'new' }] };
          },
        },
      }),
      { rule_key: 'new', criteria: { z: 1 } },
      'default'
    );
    assert.equal(refreshed, 1);
  } finally {
    if (prevRefresh === undefined) delete globalThis.__refreshGrowthAudience;
    else globalThis.__refreshGrowthAudience = prevRefresh;
  }

  const approved = await approveTouchRule(baseWinbackCtx({
    pool: { async query() { return { rows: [{ rule_key: 'r1', approved_by: 'admin' }] }; } },
  }), { ruleKey: 'r1', operatorUsername: 'admin', tenantId: 'default' });
  assert.equal(approved.body.ok, true);

  const unapproved = await unapproveTouchRule(baseWinbackCtx({
    pool: { async query() { return { rows: [{ rule_key: 'r1' }] }; } },
  }), { ruleKey: 'r1', tenantId: 'default' });
  assert.equal(unapproved.body.ok, true);

  assert.equal(
    (await unapproveTouchRule(baseWinbackCtx(), { ruleKey: 'missing', tenantId: 'default' })).status,
    404
  );

  const stats = await touchRulesStats(
    baseWinbackCtx({
      pool: {
        async query() {
          return {
            rows: [
              {
                rule_key: 'r1',
                campaign_key: 'VIP',
                sent_count: 10,
                sms_sent_count: 10,
                redeemed_count: 2,
                revenue_fen: 1000,
              },
              {
                rule_key: 'r2',
                campaign_key: 'GIFT',
                sent_count: 5,
                sms_sent_count: 0,
                redeemed_count: 0,
                revenue_fen: 0,
              },
              {
                rule_key: 'r3',
                campaign_key: 'VIP',
                sent_count: 20,
                sms_sent_count: 20,
                redeemed_count: 1,
                revenue_fen: 50,
              },
              {
                rule_key: 'r4',
                campaign_key: 'VIP',
                sent_count: 8,
                sms_sent_count: 8,
                redeemed_count: 2,
                revenue_fen: 0,
              },
              {
                rule_key: 'r5',
                campaign_key: null,
                sent_count: 0,
                sms_sent_count: 0,
                redeemed_count: 0,
                revenue_fen: 0,
              },
              {
                rule_key: 'r6',
                campaign_key: 'VIP',
                sent_count: 10,
                sms_sent_count: 10,
                redeemed_count: 2,
                revenue_fen: 20000,
              },
            ],
          };
        },
      },
    }),
    { days: 'all', tenantId: 'default' }
  );
  assert.equal(stats.body.ok, true);
  assert.equal(stats.body.cumulative, true);
  assert.ok(stats.body.stats.length >= 1);
  assert.ok(stats.body.coupon_kind_summary.cash || stats.body.coupon_kind_summary.gift);

  const statsDays = await touchRulesStats(baseWinbackCtx({
    pool: { async query() { return { rows: [] }; } },
  }), { days: 7, tenantId: 'default' });
  assert.equal(statsDays.body.days, 7);

  const aud = await touchRulesAudience(baseWinbackCtx({
    getTouchRulesAudience: async () => ({ rules: [{ k: 1 }], total: 1 }),
  }), { tenantId: 'default', store_id: 's1', refresh: '1' });
  assert.equal(aud.body.ok, true);
  assert.equal(aud.body.total, 1);

  const audFail = await touchRulesAudience(baseWinbackCtx({
    getTouchRulesAudience: async () => { throw new Error('aud'); },
  }), { tenantId: 'default' });
  assert.equal(audFail.status, 500);
});
