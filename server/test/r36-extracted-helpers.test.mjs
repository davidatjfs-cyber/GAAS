/**
 * R36：冲高 growth-pos / payment-rules / sync-failures / wechat / hrms-state 覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  listPosOrders,
  listPosOrderItems,
  listCustomerOrders,
  listPosLinkedCustomers,
  listHardcodedGrowthStores,
} from '../domains/growth-pos/service.js';
import {
  listPaymentRules,
  upsertPaymentRule,
  deletePaymentRule,
} from '../domains/growth-payment-rules/service.js';
import {
  listSyncFailures,
  registerGrowthSyncFailureRoutes,
  recordSyncFailure,
} from '../domains/growth-sync-failures/routes.js';
import {
  matchBatchToGrowthCustomers,
  importWechatCustomersManual,
  listWechatCustomers,
  wechatCustomerStats,
  importWechatCustomersFromFeishu,
} from '../domains/growth-wechat-work/service.js';
import { registerStateRoutes } from '../domains/hrms-state/routes.js';

test('growth-pos/service：过滤 / 明细 / 客户单 / linked', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 1 }] };
    },
  };
  assert.equal(listHardcodedGrowthStores().length, 2);
  await listPosOrders(pool, {
    store_id: 's1',
    phone: '138',
    from: '2026-01-01',
    to: '2026-01-31',
    limit: 10,
  });
  assert.ok(calls[0].sql.includes('store_id='));
  assert.ok(calls[0].sql.includes('biz_date>='));
  assert.ok(calls[0].sql.includes('biz_date<='));

  await assert.rejects(() => listPosOrderItems(pool, ''), (e) => e.code === 'bad_request');
  assert.deepEqual(await listPosOrderItems(pool, 'ON1'), [{ id: 1 }]);

  await assert.rejects(() => listCustomerOrders(pool, {}), (e) => e.code === 'bad_request');
  await listCustomerOrders(pool, { phone: '1' });
  await listCustomerOrders(pool, { customer_id: 9 });
  assert.deepEqual(await listPosLinkedCustomers(pool, { storeId: 's1', days: 7 }), [{ id: 1 }]);
});

test('growth-payment-rules/service：list + upsert 成功 + delete 成功', async () => {
  const ctx = {
    tenantContext: { run: async (_t, fn) => fn() },
    pool: {
      async query(sql, params) {
        if (/DELETE/.test(sql)) return { rows: [{ rule_key: params[0] }] };
        if (/INSERT/.test(sql)) return { rows: [{ rule_key: params[0], store_id: params[1] }] };
        return { rows: [{ rule_key: 'r1' }] };
      },
    },
  };
  const listed = await listPaymentRules(ctx, 'default');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.rules.length, 1);

  const up = await upsertPaymentRule(
    ctx,
    'default',
    {
      store_id: 's1',
      name: '规则',
      member_template_id: 'T1',
      rule_key: 'rk1',
      priority: 2,
      target_tags: ['vip'],
      daily_user_limit: 1,
    },
    { username: 'admin' }
  );
  assert.equal(up.status, 200);
  assert.equal(up.body.rule.rule_key, 'rk1');

  const del = await deletePaymentRule(ctx, 'rk1');
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, 'rk1');
});

test('growth-sync-failures：list + register routes', async () => {
  const pool = {
    async query() {
      return { rows: [{ id: 1 }] };
    },
  };
  assert.deepEqual(await listSyncFailures(pool, 'default'), [{ id: 1 }]);

  const routes = [];
  const app = {
    post(path, handler) {
      routes.push({ method: 'post', path, handler });
    },
    get(path, handler) {
      routes.push({ method: 'get', path, handler });
    },
  };
  registerGrowthSyncFailureRoutes(app, {
    pool,
    requirePhaseAuth: () => true,
    getPhaseTenantId: () => 'default',
  });
  assert.equal(routes.length, 2);

  const json = (body) => ({ statusCode: 200, body, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const postRes = json(null);
  await routes.find((r) => r.method === 'post').handler({ body: { source: 'x' } }, postRes);
  assert.equal(postRes.body.ok, true);

  const getRes = json(null);
  await routes.find((r) => r.method === 'get').handler({}, getRes);
  assert.equal(getRes.body.failures.length, 1);

  const routesErr = [];
  const appErr = {
    post(_p, handler) {
      routesErr.push(handler);
    },
    get(_p, handler) {
      routesErr.push(handler);
    },
  };
  registerGrowthSyncFailureRoutes(appErr, {
    pool: {
      async query() {
        throw new Error('db');
      },
    },
    requirePhaseAuth: () => true,
    getPhaseTenantId: () => 'default',
  });
  const errRes = json(null);
  await routesErr[0]({ body: {} }, errRes);
  assert.equal(errRes.statusCode, 500);

  await recordSyncFailure(pool, 'default', { source: 't', event_type: 'e' });
});

test('growth-wechat-work/service：list/stats/manual/feishu', async () => {
  const pool = {
    async query(sql) {
      if (/UPDATE wechat_work_customers/.test(sql)) return { rowCount: 2 };
      if (/INSERT INTO wechat_work_customers/.test(sql) && /RETURNING/.test(sql)) {
        return { rows: [{ id: 1 }] };
      }
      if (/INSERT INTO wechat_work_customers/.test(sql)) return { rows: [], rowCount: 1 };
      if (/GROUP BY store_id/.test(sql)) return { rows: [{ store_id: 's1', total: 1, bound: 0, unbound: 1 }] };
      return {
        rows: [
          { bind_customer_id: 1, phone: '1' },
          { bind_customer_id: null, phone: '2' },
        ],
      };
    },
  };
  assert.equal(await matchBatchToGrowthCustomers(pool, 'b1'), 2);
  const listed = await listWechatCustomers(pool, 's1');
  assert.equal(listed.total, 2);
  assert.equal(listed.bound, 1);
  assert.equal((await wechatCustomerStats(pool)).length, 1);

  const man = await importWechatCustomersManual(
    pool,
    async () => 'default',
    [{ phone: '13800138000', store_id: 's1', name: 'A' }, { name: '无手机' }]
  );
  assert.equal(man.imported, 1);

  const feishu = await importWechatCustomersFromFeishu(
    pool,
    async () => 'default',
    async () => ({ data: { items: [{ fields: { 手机号: '13900139000', 姓名: 'B' } }] } }),
    { app_token: 'app', table_id: 'tbl' }
  );
  assert.equal(feishu.imported, 1);
});

test('hrms-state/routes：UTF8 repair + PUT ignoredKeys + setImmediate 路径', async () => {
  function mockAuth(req, _res, next) {
    req.user = req._user || { role: 'admin', username: 'admin', tenant_id: 'default' };
    req.tenantId = req.user.tenant_id;
    next();
  }
  const updates = [];
  const gates = [];
  const app = express();
  app.use(express.json());
  registerStateRoutes(app, mockAuth, {
    pool: {
      async query(sql, params) {
        if (/select data from hrms_state/.test(sql)) {
          return { rows: [{ data: { dirty: true } }] };
        }
        updates.push({ sql, params });
        return { rows: [] };
      },
    },
    getSharedState: async () => ({ keep: 1 }),
    resolveTenantIdDefault: () => 'default',
    deepRepairGarbledStrings: (d, stats) => {
      if (stats) stats.changed = true;
      return { ...d, repaired: true };
    },
    hydrateStateFromAuthoritativeTables: async (_p, d) => d,
    hydrateEmployeesFromTable: async (_p, d) => d,
    hydrateFlowConfigFromTable: async (_p, d) => d,
    hydrateNotificationsFromTable: async (_p, d) => d,
    hydrateExamResultsFromTable: async (_p, d) => d,
    stripPasswordFieldsFromStateForClient: (d) => d,
    applyStatePeopleVisibilityForRole: async (d) => d,
    applyStatePutWhitelist: (ex, raw) => ({
      next: { ...ex, ...raw, employees: [{ username: 'u1' }, { username: '' }] },
      ignoredKeys: ['stores'],
    }),
    upsertPayrollDomainFromState: async () => {
      throw new Error('payroll_fail');
    },
    notifyAdminsDualWriteFailure: () => {},
    applyHrmsUserAccountGateFromEmployee: async (emp) => {
      gates.push(emp.username);
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const g = await fetch(base + '/api/state');
    assert.equal(g.status, 200);
    const body = await g.json();
    assert.equal(body.data.repaired, true);
    assert.ok(updates.some((u) => /update hrms_state/.test(u.sql)));

    const p = await fetch(base + '/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { x: 1 } }),
    });
    assert.equal(p.status, 200);
    const pb = await p.json();
    assert.deepEqual(pb.ignoredKeys, ['stores']);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(gates.includes('u1'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
