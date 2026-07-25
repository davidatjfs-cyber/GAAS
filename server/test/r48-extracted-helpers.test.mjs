/**
 * R48：flow-config / reads / agent-triggers / birthday /
 * feishu process-data-change + manual-bitable-sync + webhook routes 挂 extracted 地板。
 */
import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerFlowConfigRoutes } from '../domains/flow-config/routes.js';
import { registerReadsRoutes } from '../domains/reads/routes.js';
import { registerAgentTriggersRoutes } from '../domains/agent-triggers/routes.js';
import { registerBirthdayRoutes } from '../domains/birthday/routes.js';
import { processFeishuDataChange } from '../domains/feishu-webhook/process-data-change.js';
import { runManualFeishuBitableSync } from '../domains/feishu-sync/manual-bitable-sync.js';
import { registerFeishuWebhookRoutes } from '../domains/feishu-webhook/routes.js';

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

function mirrorPool(initialState = {}) {
  let state = { ...initialState };
  return {
    connect: async () => ({
      query: async (sql) => {
        const s = String(sql || '');
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [] };
        if (/SELECT\s+1\s+FROM/i.test(s)) return { rows: state.__exists ? [{}] : [] };
        if (/SELECT\s+data\s+FROM/i.test(s) || /FOR UPDATE/i.test(s)) {
          return { rows: [{ data: state }] };
        }
        if (/UPDATE|INSERT/i.test(s)) {
          state.__exists = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
      release() {},
    }),
    query: async () => ({ rows: [] }),
  };
}

// —— flow-config ——
test('flow-config routes: get/put role-modules + approval-flows', async () => {
  const roleCfg = { admin: ['dashboard', 'training'] };
  const flowCfg = { leave: { steps: ['store_manager', 'admin'] } };
  const payCfg = { S1: ['store_manager'] };

  await withApp(
    (app) =>
      registerFlowConfigRoutes(app, authAs({ role: 'admin', tenant_id: 't1' }), {
        pool: {
          ...mirrorPool({ roleModules: roleCfg }),
          query: async (sql) => {
            if (/SELECT config FROM/i.test(String(sql))) {
              return { rows: [] };
            }
            return { rows: [] };
          },
        },
        resolveTenantId: (req) => req.tenantId || 'default',
        getSharedState: async () => ({
          roleModules: roleCfg,
          approvalFlows: flowCfg,
          paymentFlowByStore: payCfg,
        }),
      }),
    async (base) => {
      const rm = await jsonFetch(base, '/api/role-modules');
      assert.equal(rm.status, 200);
      assert.ok(rm.body.config);

      const af = await jsonFetch(base, '/api/approval-flows');
      assert.equal(af.status, 200);
      assert.ok(af.body.ok);
    }
  );

  await withApp(
    (app) =>
      registerFlowConfigRoutes(app, authAs({ role: 'store_employee' }), {
        pool: mirrorPool(),
        resolveTenantId: () => 'default',
        getSharedState: async () => ({}),
      }),
    async (base) => {
      assert.equal(
        (
          await jsonFetch(base, '/api/role-modules', {
            method: 'PUT',
            body: JSON.stringify({ config: roleCfg }),
          })
        ).status,
        403
      );
      assert.equal(
        (
          await jsonFetch(base, '/api/approval-flows', {
            method: 'PUT',
            body: JSON.stringify({ approvalFlows: flowCfg }),
          })
        ).status,
        403
      );
    }
  );

  await withApp(
    (app) =>
      registerFlowConfigRoutes(app, authAs({ role: 'admin' }), {
        pool: {
          connect: async () => ({
            query: async (sql) => {
              const s = String(sql || '');
              if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [] };
              if (/SELECT\s+1\s+FROM/i.test(s)) return { rows: [] };
              if (/SELECT\s+data\s+FROM/i.test(s) || /FOR UPDATE/i.test(s)) {
                return { rows: [{ data: {} }] };
              }
              return { rows: [] };
            },
            release() {},
          }),
          query: async () => ({ rows: [] }),
        },
        resolveTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal(
        (
          await jsonFetch(base, '/api/role-modules', {
            method: 'PUT',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const putRm = await jsonFetch(base, '/api/role-modules', {
        method: 'PUT',
        body: JSON.stringify({ config: roleCfg }),
      });
      assert.equal(putRm.status, 200);
      assert.equal(putRm.body.ok, true);

      assert.equal(
        (
          await jsonFetch(base, '/api/approval-flows', {
            method: 'PUT',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const putAf = await jsonFetch(base, '/api/approval-flows', {
        method: 'PUT',
        body: JSON.stringify({
          approvalFlows: flowCfg,
          paymentFlowByStore: payCfg,
        }),
      });
      assert.equal(putAf.status, 200);
      assert.equal(putAf.body.ok, true);
    }
  );

  await withApp(
    (app) =>
      registerFlowConfigRoutes(app, authAs({ role: 'admin' }), {
        pool: {
          query: async () => {
            throw new Error('db');
          },
          connect: async () => {
            throw new Error('db');
          },
        },
        resolveTenantId: () => 'default',
        getSharedState: async () => {
          throw new Error('state');
        },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/role-modules')).status, 500);
      assert.equal((await jsonFetch(base, '/api/approval-flows')).status, 500);
    }
  );
});

// —— reads ——
test('reads routes: batch + unread-counts', async () => {
  await withApp(
    (app) =>
      registerReadsRoutes(app, authAs({ username: '', role: 'admin' }), {
        pool: { query: async () => ({ rows: [] }) },
        getSharedState: async () => ({}),
        stateFindUserRecord: () => null,
        dbFindEmployeeRecord: async () => null,
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/reads/batch', { method: 'POST', body: '{}' })).status,
        400
      );
      assert.equal((await jsonFetch(base, '/api/unread-counts')).status, 400);
    }
  );

  await withApp(
    (app) =>
      registerReadsRoutes(app, authAs({ username: 'u1', role: 'admin', tenant_id: 't1' }), {
        pool: {
          query: async (sql) => {
            if (/insert into user_reads/i.test(String(sql))) return { rows: [] };
            if (/select module, item_key/i.test(String(sql))) {
              return { rows: [{ module: 'training', item_key: 'old' }] };
            }
            if (/count\(\*\)/i.test(String(sql))) return { rows: [{ cnt: 2 }] };
            return { rows: [] };
          },
        },
        getSharedState: async () => ({
          trainingTasks: [
            { id: 't1', status: 'open', scope: { type: 'all' } },
            { id: 'old', status: 'open', scope: { type: 'all' } },
            { id: 't2', status: 'cancelled', scope: { type: 'all' } },
          ],
          examAssignments: [
            { id: 'e1', scope: { type: 'all' } },
            { id: 'e2', scope: { type: 'user', users: ['other'] } },
          ],
          notifications: [
            { id: 'n1', targetUser: 'u1' },
            { id: 'n2', scope: { type: 'all' } },
            { id: 'n3', scope: { type: 'store', store: 'S1' } },
            { id: 'n4', targetUser: 'other' },
          ],
        }),
        stateFindUserRecord: () => ({ store: 'S1', department: 'D', position: 'P' }),
        dbFindEmployeeRecord: async () => null,
      }),
    async (base) => {
      assert.equal(
        (
          await jsonFetch(base, '/api/reads/batch', {
            method: 'POST',
            body: JSON.stringify({ module: 'm' }),
          })
        ).body.inserted,
        0
      );
      assert.equal(
        (
          await jsonFetch(base, '/api/reads/batch', {
            method: 'POST',
            body: JSON.stringify({ keys: ['a'] }),
          })
        ).status,
        400
      );
      const batch = await jsonFetch(base, '/api/reads/batch', {
        method: 'POST',
        body: JSON.stringify({ module: 'approval', keys: ['k1', 'k2'] }),
      });
      assert.equal(batch.status, 200);
      assert.equal(batch.body.inserted, 2);

      const unread = await jsonFetch(base, '/api/unread-counts');
      assert.equal(unread.status, 200);
      assert.equal(unread.body.approvals, 2);
      assert.ok(unread.body.training >= 1);
      assert.ok(unread.body.exam >= 1);
      assert.ok(unread.body.dashboard >= 1);
    }
  );

  await withApp(
    (app) =>
      registerReadsRoutes(app, authAs({ username: 'u1' }), {
        pool: {
          query: async () => {
            throw new Error('db');
          },
        },
        getSharedState: async () => ({}),
        stateFindUserRecord: () => null,
        dbFindEmployeeRecord: async () => null,
      }),
    async (base) => {
      assert.equal(
        (
          await jsonFetch(base, '/api/reads/batch', {
            method: 'POST',
            body: JSON.stringify({ module: 'm', keys: ['k'] }),
          })
        ).status,
        500
      );
      assert.equal((await jsonFetch(base, '/api/unread-counts')).status, 500);
    }
  );
});

// —— agent-triggers ——
test('agent-triggers routes: gates + deps happy/error', async () => {
  const depsOk = {
    pool: () => ({ query: async () => ({ rows: [] }) }),
    runDataAuditor: async () => ({ issuesCreated: 0, newIssueIds: [] }),
    pushIssuesToFeishu: async () => 0,
    syncDataAuditorIssuesToMasterTasks: async () => 0,
    runChiefEvaluator: async () => ({ scored: 1 }),
    pushScoresToFeishu: async () => 1,
    sendLarkMessage: async (openId, text) => ({ ok: true, openId, text }),
    callVisionLLM: async () => ({ ok: true, content: 'kitchen' }),
    callLLM: async () => ({ ok: true, content: '潮汕' }),
    verifyLLMHealth: async () => ({ healthy: true }),
    getLarkTenantToken: async () => 'abcdefghijklmnop',
    routeMessage: async () => 'audit',
    inferBrandFromStoreName: () => 'B',
    calculateStoreRating: async () => ({}),
    defaultLlmModel: 'm1',
  };

  await withApp(
    (app) => registerAgentTriggersRoutes(app, authAs({ role: 'store_employee' }), depsOk),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/agents/run/audit', { method: 'POST' })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/agents/run/store-ratings', { method: 'POST' })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/agents/run/evaluate', { method: 'POST' })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/agents/test-feishu', { method: 'POST' })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/agents/test-vision', { method: 'POST' })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/agents/test-llm', { method: 'POST' })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/agents/llm-health-check', { method: 'POST' })).status,
        403
      );
      assert.equal((await jsonFetch(base, '/api/agents/feishu-token-test')).status, 403);
      assert.equal(
        (await jsonFetch(base, '/api/agents/feishu-send-test', { method: 'POST' })).status,
        403
      );
      const route = await jsonFetch(base, '/api/agents/route-test', {
        method: 'POST',
        body: JSON.stringify({ text: '毛利异常', hasImage: false }),
      });
      assert.equal(route.status, 200);
      assert.equal(route.body.route, 'audit');
      assert.ok(route.body.matchedKeywords.length >= 1);
    }
  );

  await withApp(
    (app) =>
      registerAgentTriggersRoutes(app, authAs({ role: 'admin', username: 'a1', tenant_id: 't1' }), {
        ...depsOk,
        runManualAudit: undefined,
      }),
    async (base) => {
      // runManualAudit is inside service — deps use runDataAuditor
      const audit = await jsonFetch(base, '/api/agents/run/audit', {
        method: 'POST',
        body: JSON.stringify({ mode: 'daily' }),
      });
      assert.equal(audit.status, 200);

      const ratings = await jsonFetch(base, '/api/agents/run/store-ratings', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-07' }),
      });
      assert.equal(ratings.status, 200);

      assert.equal(
        (
          await jsonFetch(base, '/api/agents/run/evaluate', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const ev = await jsonFetch(base, '/api/agents/run/evaluate', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-07' }),
      });
      assert.equal(ev.status, 200);
      assert.equal(ev.body.feishuPushed, 1);

      assert.equal(
        (await jsonFetch(base, '/api/agents/test-feishu', { method: 'POST', body: '{}' })).status,
        400
      );
      const feishu = await jsonFetch(base, '/api/agents/test-feishu', {
        method: 'POST',
        body: JSON.stringify({ openId: 'ou_1', text: 'hi' }),
      });
      assert.equal(feishu.status, 200);

      assert.equal(
        (await jsonFetch(base, '/api/agents/test-vision', { method: 'POST', body: '{}' })).status,
        400
      );
      assert.equal(
        (
          await jsonFetch(base, '/api/agents/test-vision', {
            method: 'POST',
            body: JSON.stringify({ imageUrl: 'https://x/a.png' }),
          })
        ).status,
        200
      );

      assert.equal(
        (
          await jsonFetch(base, '/api/agents/test-llm', {
            method: 'POST',
            body: JSON.stringify({ prompt: 'hi' }),
          })
        ).status,
        200
      );

      assert.equal(
        (await jsonFetch(base, '/api/agents/llm-health-check', { method: 'POST' })).status,
        200
      );

      const tok = await jsonFetch(base, '/api/agents/feishu-token-test');
      assert.equal(tok.status, 200);
      assert.equal(tok.body.ok, true);

      assert.equal(
        (await jsonFetch(base, '/api/agents/feishu-send-test', { method: 'POST', body: '{}' }))
          .status,
        400
      );
      assert.equal(
        (
          await jsonFetch(base, '/api/agents/feishu-send-test', {
            method: 'POST',
            body: JSON.stringify({ openId: 'ou_2' }),
          })
        ).status,
        200
      );
    }
  );

  await withApp(
    (app) =>
      registerAgentTriggersRoutes(app, authAs({ role: 'admin' }), {
        ...depsOk,
        getLarkTenantToken: async () => '',
        runDataAuditor: async () => {
          throw new Error('x');
        },
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/agents/run/audit', { method: 'POST' })).status,
        500
      );
      const tok = await jsonFetch(base, '/api/agents/feishu-token-test');
      assert.equal(tok.status, 200);
      assert.equal(tok.body.ok, false);
    }
  );
});

// —— birthday ——
test('birthday routes: check + upcoming', async () => {
  const employees = [
    {
      username: 'bday',
      name: '寿星',
      birthday: '1990-07-26',
      store: 'S1',
      role: 'store_employee',
      status: '在职',
    },
    {
      username: 'sm1',
      name: '店长',
      birthday: '1991-08-01',
      store: 'S1',
      role: 'store_manager',
      status: '在职',
    },
    {
      username: 'tmr',
      name: '明日寿',
      birthday: '1992-07-27',
      store: 'S1',
      role: 'store_employee',
      status: '在职',
    },
  ];

  const deps = {
    getSharedState: async () => ({ employees }),
    saveSharedState: async () => {},
    isInactiveStatus: () => false,
    employeeAccountShouldDisable: () => false,
    addStateNotification: (state, n) => {
      const notifications = Array.isArray(state.notifications) ? state.notifications.slice() : [];
      notifications.push(n);
      return { ...state, notifications };
    },
    makeNotif: (user, title, message, extra) => ({ targetUser: user, title, message, ...extra }),
    hrmsNowISO: () => '2026-07-26T09:00:00+08:00',
    pickAdminUsername: async () => 'admin',
    pickHrManagerUsername: async () => 'hr1',
    stateFindUserRecord: (_s, u) => ({ name: u }),
  };

  await withApp(
    (app) => registerBirthdayRoutes(app, authAs({ role: 'store_employee' }), deps),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/birthday/check', { method: 'POST' })).status,
        403
      );
      const up = await jsonFetch(base, '/api/birthday/upcoming?days=60');
      assert.equal(up.status, 200);
      assert.ok(Array.isArray(up.body.upcoming));
    }
  );

  await withApp(
    (app) => registerBirthdayRoutes(app, authAs({ role: 'admin', username: 'admin' }), deps),
    async (base) => {
      assert.equal(
        (
          await jsonFetch(base, '/api/birthday/check', {
            method: 'POST',
            body: JSON.stringify({ date: 'not-a-date' }),
          })
        ).status,
        400
      );
      // 用固定日期覆盖当天祝福 + 明日提醒；月底路径另测
      const check = await jsonFetch(base, '/api/birthday/check', {
        method: 'POST',
        body: JSON.stringify({ date: '2026-07-26' }),
      });
      assert.equal(check.status, 200);
      assert.equal(check.body.ok, true);
      assert.ok(check.body.results.greetings.length >= 1);
      assert.ok(check.body.results.reminders1day.length >= 1);

      const eom = await jsonFetch(base, '/api/birthday/check', {
        method: 'POST',
        body: JSON.stringify({ date: '2026-07-31' }),
      });
      assert.equal(eom.status, 200);
      assert.equal(eom.body.isEndOfMonth, true);
    }
  );

  await withApp(
    (app) =>
      registerBirthdayRoutes(app, authAs({ role: 'store_manager', username: 'sm1' }), deps),
    async (base) => {
      const up = await jsonFetch(base, '/api/birthday/upcoming?days=40');
      assert.equal(up.status, 200);
      assert.ok(up.body.upcoming.every((x) => x.store === 'S1' || !x.store));
    }
  );

  await withApp(
    (app) =>
      registerBirthdayRoutes(app, authAs({ role: 'admin' }), {
        ...deps,
        getSharedState: async () => {
          throw new Error('boom');
        },
      }),
    async (base) => {
      assert.equal(
        (
          await jsonFetch(base, '/api/birthday/check', {
            method: 'POST',
            body: JSON.stringify({ date: '2026-07-26' }),
          })
        ).status,
        500
      );
      assert.equal((await jsonFetch(base, '/api/birthday/upcoming')).status, 500);
    }
  );
});

// —— process-data-change ——
test('processFeishuDataChange: non-visit + visit + failure', async () => {
  const updates = [];
  const baseCtx = {
    pool: {
      query: async (sql, params) => {
        updates.push([String(sql).slice(0, 40), params?.[0]]);
        return { rows: [] };
      },
    },
    safeErrMessage: (e) => String(e?.message || e),
    resolveTenantIdDefault: () => 'default',
    loadTenantFeishuBitableConfig: async () => null,
    getFeishuTokenByConfig: async () => 'tok',
    getFeishuAccessToken: async () => 'tok',
    getFeishuBitableData: async () => ({
      items: [{ record_id: 'r1', fields: { a: 1 } }],
    }),
    findConfigKeyByTableInfo: () => 'k1',
    upsertFeishuGenericRecord: async () => {},
    mapFeishuFieldToHrms: () => ({ date: '2026-07-01', store: 'S1', recordId: 'r1' }),
    upsertTableVisitRecordFromMapped: async () => {},
    notifyAdminsDualWriteFailure: () => {},
  };

  await processFeishuDataChange(
    { app_token: 'app', table_id: 'other', record_id: 'r1' },
    'log1',
    baseCtx
  );
  assert.ok(updates.some((u) => u[0].includes('success') || u[1] === 'success'));

  updates.length = 0;
  await processFeishuDataChange(
    { app_token: 'app', table_id: 'tblpx5Efqc6eHo3L', record_id: 'r1' },
    'log2',
    baseCtx
  );
  assert.ok(updates.length >= 1);

  await assert.rejects(
    () =>
      processFeishuDataChange(
        { app_token: 'app', table_id: 'other', record_id: 'missing' },
        'log3',
        {
          ...baseCtx,
          getFeishuBitableData: async () => ({ items: [] }),
        }
      ),
    /Record not found/
  );
});

// —— manual-bitable-sync ——
test('runManualFeishuBitableSync: missing + visit + skip + fail notify', async () => {
  await assert.rejects(
    () => runManualFeishuBitableSync({}, { appToken: '', tableId: '' }),
    /missing_app_token/
  );

  const notified = [];
  const out = await runManualFeishuBitableSync(
    {
      getFeishuAccessToken: async () => 'tok',
      getFeishuBitableData: async () => ({
        items: [
          { record_id: 'r1' },
          { record_id: 'r2' },
          { record_id: 'r3' },
        ],
      }),
      findConfigKeyByTableInfo: () => 'k',
      upsertFeishuGenericRecord: async () => {},
      mapFeishuFieldToHrms: (rec) => {
        if (rec.record_id === 'r1') return { date: '2026-07-01', store: 'S1' };
        if (rec.record_id === 'r2') return { date: '', store: '' };
        throw new Error('map_fail');
      },
      upsertTableVisitRecordFromMapped: async () => {},
      notifyAdminsDualWriteFailure: (_t, e) => {
        notified.push(String(e?.message || e));
      },
    },
    { appToken: 'app', tableId: 'tblpx5Efqc6eHo3L' }
  );
  assert.equal(out.isTableVisit, true);
  assert.equal(out.synced, 1);
  assert.equal(out.failed, 2);
  assert.equal(out.genericUpserted, 3);
  assert.ok(notified.length >= 1);

  const nonVisit = await runManualFeishuBitableSync(
    {
      getFeishuAccessToken: async () => 'tok',
      getFeishuBitableData: async () => ({ items: [{ record_id: 'x' }] }),
      findConfigKeyByTableInfo: () => 'k',
      upsertFeishuGenericRecord: async () => {},
      mapFeishuFieldToHrms: () => ({}),
      upsertTableVisitRecordFromMapped: async () => {},
      notifyAdminsDualWriteFailure: () => {},
    },
    { appToken: 'app', tableId: 'tblOther' }
  );
  assert.equal(nonVisit.isTableVisit, false);
  assert.equal(nonVisit.genericUpserted, 1);
  assert.equal(nonVisit.synced, 0);
});

// —— feishu webhook routes ——
// 该路由自带 express.raw，不能挂全局 express.json，否则 body 被抢先消费。
async function withWebhookApp(deps, fn) {
  const app = express();
  registerFeishuWebhookRoutes(app, deps);
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

async function rawJsonFetch(base, bodyObj) {
  const res = await fetch(base + '/api/webhook/feishu', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bodyObj),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('feishu webhook routes: disabled / challenge / sig / event / bitable', async () => {
  const baseDeps = {
    express,
    pool: { query: async () => ({ rows: [] }) },
    isWebhookEnabled: () => false,
    tryParseJson: (t) => {
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    },
    verifyFeishuWebhookRequest: () => ({ ok: true }),
    requireWebhookSignature: () => false,
    decryptFeishuEncryptPayload: (enc) => {
      if (enc === 'bad') throw new Error('decrypt');
      return JSON.stringify({ type: 'url_verification', challenge: 'from-enc' });
    },
    resolveWebhookTenantId: async () => 'default',
    tenantContext: { run: (_t, fn) => fn() },
    randomUUID: () => 'uuid-1',
    safeErrMessage: (e) => String(e?.message || e),
    notifyAdminsDualWriteFailure: () => {},
    onFeishuEvent: async () => ({ ok: true }),
    resolveTenantIdDefault: () => 'default',
    loadTenantFeishuBitableConfig: async () => null,
    getFeishuTokenByConfig: async () => 't',
    getFeishuAccessToken: async () => 't',
    getFeishuBitableData: async () => ({
      items: [{ record_id: 'r1', fields: {} }],
    }),
    findConfigKeyByTableInfo: () => 'k',
    upsertFeishuGenericRecord: async () => {},
    mapFeishuFieldToHrms: () => ({ date: '2026-07-01', store: 'S1' }),
    upsertTableVisitRecordFromMapped: async () => {},
  };

  await withWebhookApp(baseDeps, async (base) => {
    const res = await fetch(base + '/api/webhook/feishu', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 404);
  });

  await withWebhookApp(
    {
      ...baseDeps,
      isWebhookEnabled: () => true,
      verifyFeishuWebhookRequest: ({ parsedBody }) => {
        if (parsedBody?.badSig) return { ok: false, reason: 'bad_sig' };
        return { ok: true, mode: 'skipped' };
      },
      onFeishuEvent: async () => {
        throw new Error('agent_boom');
      },
    },
    async (base) => {
      const challenge = await rawJsonFetch(base, {
        type: 'url_verification',
        challenge: 'c123',
      });
      assert.equal(challenge.status, 200);
      assert.equal(challenge.body.challenge, 'c123');

      const sig = await rawJsonFetch(base, { badSig: true });
      assert.equal(sig.status, 401);

      const encBad = await rawJsonFetch(base, { encrypt: 'bad' });
      assert.equal(encBad.status, 400);

      const encOk = await rawJsonFetch(base, { encrypt: 'ok' });
      assert.equal(encOk.status, 200);
      assert.equal(encOk.body.challenge, 'from-enc');

      const agentFail = await rawJsonFetch(base, {
        header: { event_type: 'im.message.receive_v1' },
      });
      assert.equal(agentFail.status, 500);
    }
  );

  await withWebhookApp(
    {
      ...baseDeps,
      isWebhookEnabled: () => true,
      onFeishuEvent: async () => ({ handled: true }),
    },
    async (base) => {
      const evt = await rawJsonFetch(base, {
        header: { event_type: 'im.message.receive_v1' },
        event: { type: 'message' },
      });
      assert.equal(evt.status, 200);
      assert.equal(evt.body.handled, true);

      const changed = await rawJsonFetch(base, {
        header: { event_type: 'bitable.record.changed' },
        event: {
          app_token: 'app',
          table_id: 'tblOther',
          record_id: 'r1',
        },
      });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.code, 0);
      await new Promise((r) => setTimeout(r, 40));
    }
  );

  // requireWebhookSignature + token mismatch
  const prevToken = process.env.FEISHU_VERIFICATION_TOKEN;
  process.env.FEISHU_VERIFICATION_TOKEN = 'expect-token';
  try {
    await withWebhookApp(
      {
        ...baseDeps,
        isWebhookEnabled: () => true,
        requireWebhookSignature: () => true,
        verifyFeishuWebhookRequest: () => ({ ok: true }),
      },
      async (base) => {
        const badTok = await rawJsonFetch(base, {
          type: 'event',
          token: 'wrong',
          header: { event_type: 'x' },
        });
        assert.equal(badTok.status, 401);
      }
    );
  } finally {
    if (prevToken == null) delete process.env.FEISHU_VERIFICATION_TOKEN;
    else process.env.FEISHU_VERIFICATION_TOKEN = prevToken;
  }
});
