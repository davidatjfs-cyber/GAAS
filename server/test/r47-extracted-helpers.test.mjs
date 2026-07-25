/**
 * R47：薄 routes（admin-ops / ops-tasks / agent-ops / agent-data-center /
 * payment-config / stores / agent-records）挂 extracted 地板。
 */
import { createServer } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerAdminOpsRoutes } from '../domains/admin-ops/routes.js';
import { registerOpsTasksRoutes } from '../domains/ops-tasks/routes.js';
import { registerAgentOpsRoutes } from '../domains/agent-ops/routes.js';
import { registerAgentDataCenterRoutes } from '../domains/agent-data-center/routes.js';
import { registerPaymentConfigRoutes } from '../domains/payment-config/routes.js';
import { registerStoresDomainRoutes } from '../domains/stores/routes.js';
import { registerAgentRecordsRoutes } from '../domains/agent-records/routes.js';

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
    connect: async () => {
      const client = {
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
      };
      return client;
    },
    query: async () => ({ rows: [] }),
  };
}

// —— admin-ops ——
test('admin-ops routes: gates + happy paths', async () => {
  const deps = {
    pool: {
      query: async (_sql, params) => {
        if (String(params?.[0] || '').toLowerCase() === 'boss') {
          return { rows: [{ username: 'boss', role: 'admin' }] };
        }
        return { rows: [] };
      },
    },
    canAccessDailyAttendanceRegister: (role) => role === 'admin',
    safeDateOnly: (v) => (v ? String(v).slice(0, 10) : null),
    safeMonthOnly: (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : null),
    safeErrMessage: (e) => String(e?.message || e),
    backfillDailyAttendanceRegisterMissing: async () => ({ inserted: 2 }),
    runLeaveCumulativeCloseSnapshotForClosedMonth: async (m) => ({ ok: true, month: m }),
    runSalesRawFolderImportOnce: async () => ({ ok: true, scanned: 0 }),
    notifyAdminsDualWriteFailure: () => {},
    normalizeRoleForJwt: (r) => r,
    loadEmployeesFromTable: async () => [{ username: 'alice', password: 'p1' }],
    getSharedState: async () => ({ employees: [], users: [] }),
    sendAdminSystemAlert: async () => ({ sent: 1 }),
    hrmsNowISO: () => '2026-07-26T00:00:00+08:00',
  };

  await withApp(
    (app) => registerAdminOpsRoutes(app, authAs({ role: 'store_employee' }), deps),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/admin/reconcile-daily-attendance-register-from-pg', { method: 'POST' }))
          .status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/admin/leave-close-snapshot/recompute', { method: 'POST' })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/admin/sales-raw/run-folder-import', { method: 'POST' })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/admin/employee-password/alice')).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/admin/system-alert/test', { method: 'POST' })).status,
        403
      );
    }
  );

  await withApp(
    (app) => registerAdminOpsRoutes(app, authAs({ role: 'admin', username: 'a1', tenant_id: 't1' }), deps),
    async (base) => {
      const rec = await jsonFetch(base, '/api/admin/reconcile-daily-attendance-register-from-pg', {
        method: 'POST',
        body: JSON.stringify({ start: '2026-07-01', end: '2026-07-02' }),
      });
      assert.equal(rec.status, 200);
      assert.equal(rec.body.inserted, 2);

      assert.equal(
        (
          await jsonFetch(base, '/api/admin/leave-close-snapshot/recompute', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const snap = await jsonFetch(base, '/api/admin/leave-close-snapshot/recompute', {
        method: 'POST',
        body: JSON.stringify({ month: '2026-06' }),
      });
      assert.equal(snap.status, 200);
      assert.equal(snap.body.month, '2026-06');

      const folder = await jsonFetch(base, '/api/admin/sales-raw/run-folder-import', { method: 'POST' });
      assert.equal(folder.status, 200);

      assert.equal((await jsonFetch(base, '/api/admin/employee-password/%20')).status, 400);
      const pw = await jsonFetch(base, '/api/admin/employee-password/alice');
      assert.equal(pw.status, 200);
      assert.equal(pw.body.password, 'p1');

      assert.equal(
        (
          await jsonFetch(base, '/api/admin/system-alert/test', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      assert.equal(
        (
          await jsonFetch(base, '/api/admin/system-alert/test', {
            method: 'POST',
            body: JSON.stringify({ username: 'nobody' }),
          })
        ).status,
        400
      );
      const alert = await jsonFetch(base, '/api/admin/system-alert/test', {
        method: 'POST',
        body: JSON.stringify({ username: 'boss' }),
      });
      assert.equal(alert.status, 200);
      assert.equal(alert.body.ok, true);
    }
  );

  await withApp(
    (app) =>
      registerAdminOpsRoutes(app, authAs({ role: 'admin' }), {
        ...deps,
        pool: null,
        loadEmployeesFromTable: async () => {
          throw new Error('boom');
        },
      }),
    async (base) => {
      assert.equal(
        (
          await jsonFetch(base, '/api/admin/reconcile-daily-attendance-register-from-pg', {
            method: 'POST',
          })
        ).status,
        503
      );
      assert.equal((await jsonFetch(base, '/api/admin/employee-password/x')).status, 500);
    }
  );
});

// —— ops-tasks ——
test('ops-tasks routes: list / read / complete', async () => {
  let lastSql = '';
  const pool = {
    query: async (sql, params) => {
      lastSql = String(sql);
      if (/from ops_tasks where id/i.test(lastSql)) {
        if (params?.[0] === 'missing') return { rows: [] };
        if (params?.[0] === 'done1') {
          return { rows: [{ id: 'done1', assignee_username: 'e1', status: 'done', required_photos: 1 }] };
        }
        return {
          rows: [{ id: 't1', assignee_username: 'e1', status: 'open', required_photos: 1, due_at: null }],
        };
      }
      if (/update ops_tasks/i.test(lastSql)) {
        return {
          rows: [{ id: 't1', status: 'done', feedback_score: 3, feedback_text: 'ok', evidence_urls: [] }],
        };
      }
      return { rows: [{ id: 't1' }] };
    },
  };

  await withApp(
    (app) =>
      registerOpsTasksRoutes(app, authAs({ role: 'store_employee', username: 'e1' }), {
        pool,
        safeDateOnly: () => null,
        normalizeOpsRole: (r) => String(r || ''),
        buildOpsFeedback: () => ({ score: 3, feedback: 'ok' }),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/ops/tasks')).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerOpsTasksRoutes(app, authAs({ role: 'admin', username: '' }), {
        pool,
        safeDateOnly: (v) => (v ? String(v) : null),
        normalizeOpsRole: (r) => String(r || ''),
        buildOpsFeedback: () => ({ score: 3, feedback: 'ok' }),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/ops/tasks')).status, 400);
      assert.equal((await jsonFetch(base, '/api/ops/tasks/x/read', { method: 'POST' })).status, 400);
    }
  );

  await withApp(
    (app) =>
      registerOpsTasksRoutes(app, authAs({ role: 'store_manager', username: 'e1' }), {
        pool,
        safeDateOnly: (v) => (v ? String(v).slice(0, 10) : null),
        normalizeOpsRole: (r) => String(r || ''),
        buildOpsFeedback: () => ({ score: 3, feedback: 'ok' }),
      }),
    async (base) => {
      const list = await jsonFetch(base, '/api/ops/tasks?status=todo&date=2026-07-01&store=S1');
      assert.equal(list.status, 200);
      assert.ok(Array.isArray(list.body.items));

      const listAll = await jsonFetch(base, '/api/ops/tasks?status=all');
      assert.equal(listAll.status, 200);

      assert.equal((await jsonFetch(base, '/api/ops/tasks/%20/read', { method: 'POST' })).status, 400);
      const read = await jsonFetch(base, '/api/ops/tasks/t1/read', { method: 'POST' });
      assert.equal(read.status, 200);

      assert.equal(
        (
          await jsonFetch(base, '/api/ops/tasks/t1/complete', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      assert.equal(
        (
          await jsonFetch(base, '/api/ops/tasks/missing/complete', {
            method: 'POST',
            body: JSON.stringify({ evidenceUrls: ['/u.png'] }),
          })
        ).status,
        404
      );
      assert.equal(
        (
          await jsonFetch(base, '/api/ops/tasks/done1/complete', {
            method: 'POST',
            body: JSON.stringify({ evidenceUrls: ['/u.png'] }),
          })
        ).status,
        400
      );
      const done = await jsonFetch(base, '/api/ops/tasks/t1/complete', {
        method: 'POST',
        body: JSON.stringify({ evidenceUrls: ['/u.png'], note: 'n' }),
      });
      assert.equal(done.status, 200);
      assert.equal(done.body.item.status, 'done');
    }
  );

  await withApp(
    (app) =>
      registerOpsTasksRoutes(app, authAs({ role: 'store_manager', username: 'other' }), {
        pool,
        safeDateOnly: () => null,
        normalizeOpsRole: (r) => String(r || ''),
        buildOpsFeedback: () => ({ score: 1, feedback: 'x' }),
      }),
    async (base) => {
      assert.equal(
        (
          await jsonFetch(base, '/api/ops/tasks/t1/complete', {
            method: 'POST',
            body: JSON.stringify({ evidenceUrls: ['/u.png'] }),
          })
        ).status,
        403
      );
    }
  );

  await withApp(
    (app) =>
      registerOpsTasksRoutes(app, authAs({ role: 'admin', username: 'a' }), {
        pool: {
          query: async () => {
            throw new Error('db');
          },
        },
        safeDateOnly: () => null,
        normalizeOpsRole: (r) => String(r || ''),
        buildOpsFeedback: () => ({ score: 1, feedback: 'x' }),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/ops/tasks')).status, 500);
      assert.equal((await jsonFetch(base, '/api/ops/tasks/t1/read', { method: 'POST' })).status, 500);
    }
  );
});

// —— agent-ops ——
test('agent-ops routes: role gates + deps', async () => {
  const poolFn = () => ({
    query: async (sql) => {
      if (/FROM agent_autonomous_tasks WHERE id/i.test(String(sql))) {
        return { rows: [{ owner_username: 'a1', requester_username: 'a1' }] };
      }
      return { rows: [] };
    },
  });

  await withApp(
    (app) =>
      registerAgentOpsRoutes(app, authAs({ role: 'store_employee', username: 'e1' }), {
        pool: poolFn,
        getAgentPerformanceMetrics: () => ({ hits: 1 }),
        runAgentEvalSuite: async () => ({ score: 1 }),
        getScheduledTaskStatus: () => ({ ok: true }),
        clearAgentCache: () => {},
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/performance')).status, 403);
      assert.equal(
        (await jsonFetch(base, '/api/agents/eval-suite/run', { method: 'POST' })).status,
        403
      );
      assert.equal((await jsonFetch(base, '/api/agents/eval-suite/runs')).status, 403);
      assert.equal((await jsonFetch(base, '/api/agents/quality-audits')).status, 403);
      assert.equal((await jsonFetch(base, '/api/agents/scheduler-status')).status, 403);
      assert.equal(
        (await jsonFetch(base, '/api/agents/clear-cache', { method: 'POST' })).status,
        403
      );
      const tasks = await jsonFetch(base, '/api/agents/autonomous-tasks');
      assert.equal(tasks.status, 200);
    }
  );

  await withApp(
    (app) =>
      registerAgentOpsRoutes(app, authAs({ role: 'admin', username: 'a1', tenant_id: 't1' }), {
        pool: poolFn,
        getAgentPerformanceMetrics: () => ({ hits: 9 }),
        runAgentEvalSuite: async (opts) => ({ suite: opts.suiteName }),
        getScheduledTaskStatus: () => ({ jobs: 2 }),
        clearAgentCache: () => {},
      }),
    async (base) => {
      const perf = await jsonFetch(base, '/api/agents/performance');
      assert.equal(perf.status, 200);
      assert.equal(perf.body.metrics.hits, 9);

      const run = await jsonFetch(base, '/api/agents/eval-suite/run', {
        method: 'POST',
        body: JSON.stringify({ suiteName: 'smoke' }),
      });
      assert.equal(run.status, 200);
      assert.equal(run.body.result.suite, 'smoke');

      assert.equal((await jsonFetch(base, '/api/agents/eval-suite/runs')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/quality-audits')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/scheduler-status')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/clear-cache', { method: 'POST' })).status, 200);

      assert.equal(
        (
          await jsonFetch(base, '/api/agents/autonomous-tasks/%20/resolve', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const resolved = await jsonFetch(base, '/api/agents/autonomous-tasks/tid1/resolve', {
        method: 'POST',
        body: JSON.stringify({ note: 'done' }),
      });
      assert.equal(resolved.status, 200);
    }
  );

  await withApp(
    (app) =>
      registerAgentOpsRoutes(app, authAs({ role: 'admin', username: 'a1' }), {
        pool: () => ({
          query: async () => {
            throw new Error('db');
          },
        }),
        getAgentPerformanceMetrics: () => {
          throw new Error('m');
        },
        runAgentEvalSuite: async () => {
          throw new Error('e');
        },
        getScheduledTaskStatus: () => {
          throw new Error('s');
        },
        clearAgentCache: () => {
          throw new Error('c');
        },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/performance')).status, 500);
      assert.equal(
        (await jsonFetch(base, '/api/agents/eval-suite/run', { method: 'POST' })).status,
        500
      );
      assert.equal((await jsonFetch(base, '/api/agents/eval-suite/runs')).status, 500);
      assert.equal((await jsonFetch(base, '/api/agents/autonomous-tasks')).status, 500);
      assert.equal((await jsonFetch(base, '/api/agents/quality-audits')).status, 500);
      assert.equal((await jsonFetch(base, '/api/agents/scheduler-status')).status, 500);
      assert.equal(
        (await jsonFetch(base, '/api/agents/clear-cache', { method: 'POST' })).status,
        500
      );
    }
  );
});

// —— agent-data-center ——
test('agent-data-center routes: roles + mock pool', async () => {
  const poolOk = () => ({
    query: async (sql) => {
      const s = String(sql);
      if (/FROM feishu_users/i.test(s) && /LOWER\(TRIM\(username\)\)/i.test(s)) {
        return { rows: [{ username: 'u1', disp: 'U1', store: 'S', role: 'staff' }] };
      }
      if (/FROM agent_scores/i.test(s)) return { rows: [] };
      if (/FROM hrms_user_notifications/i.test(s)) return { rows: [] };
      return { rows: [{}] };
    },
  });

  await withApp(
    (app) =>
      registerAgentDataCenterRoutes(app, authAs({ role: 'store_employee' }), {
        pool: poolOk,
        getAgentPerformanceMetrics: () => ({}),
        cronJobLabelZh: (k) => k,
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/dashboard')).status, 403);
      assert.equal((await jsonFetch(base, '/api/agents/data-center-brief')).status, 403);
      assert.equal((await jsonFetch(base, '/api/agents/activity-detail')).status, 403);
      assert.equal((await jsonFetch(base, '/api/agents/score-provenance')).status, 403);
      assert.equal((await jsonFetch(base, '/api/agents/employee-live-dashboard')).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerAgentDataCenterRoutes(app, authAs({ role: 'admin', username: 'a1', tenant_id: 't1' }), {
        pool: poolOk,
        getAgentPerformanceMetrics: () => ({ ok: 1 }),
        cronJobLabelZh: (k) => `zh:${k}`,
      }),
    async (base) => {
      const dash = await jsonFetch(base, '/api/agents/dashboard');
      assert.equal(dash.status, 200);
      assert.ok('openIssues' in dash.body);

      const brief = await jsonFetch(base, '/api/agents/data-center-brief?activityDate=2026-07-01');
      assert.equal(brief.status, 200);
      assert.equal(brief.body.activitySummaryDate, '2026-07-01');

      const act = await jsonFetch(base, '/api/agents/activity-detail?date=2026-07-01');
      assert.equal(act.status, 200);

      assert.equal((await jsonFetch(base, '/api/agents/score-provenance')).status, 400);
      const prov = await jsonFetch(base, '/api/agents/score-provenance?q=u1');
      assert.equal(prov.status, 200);
      assert.equal(prov.body.username, 'u1');

      const live = await jsonFetch(base, '/api/agents/employee-live-dashboard?q=u1&period=2026-07');
      assert.equal(live.status, 200);
    }
  );

  await withApp(
    (app) =>
      registerAgentDataCenterRoutes(app, authAs({ role: 'admin', username: 'a1' }), {
        pool: () => ({
          query: async () => {
            throw new Error('db');
          },
        }),
        getAgentPerformanceMetrics: () => ({}),
        cronJobLabelZh: (k) => k,
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/dashboard')).status, 500);
      // brief/activity catch internal queries — may still 200
      assert.equal((await jsonFetch(base, '/api/agents/data-center-brief')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/activity-detail')).status, 200);
    }
  );
});

// —— payment-config ——
test('payment-config routes: get + put', async () => {
  await withApp(
    (app) =>
      registerPaymentConfigRoutes(app, authAs({ role: 'admin', tenant_id: 't1' }), {
        pool: mirrorPool({ paymentSettings: { a: 1 }, paymentBudgets: {} }),
        getSharedState: async () => ({ paymentSettings: { x: 1 }, paymentBudgets: { y: 2 } }),
        resolveTenantId: (req) => req.tenantId || 'default',
      }),
    async (base) => {
      const got = await jsonFetch(base, '/api/payment-config');
      assert.equal(got.status, 200);

      const put = await jsonFetch(base, '/api/payment-config', {
        method: 'PUT',
        body: JSON.stringify({
          paymentSettings: { enabled: true },
          paymentBudgets: {},
        }),
      });
      assert.equal(put.status, 200);
      assert.equal(put.body.ok, true);
    }
  );

  await withApp(
    (app) =>
      registerPaymentConfigRoutes(app, authAs({ role: 'store_employee' }), {
        pool: mirrorPool(),
        getSharedState: async () => ({}),
        resolveTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/payment-config', { method: 'PUT', body: '{}' })).status,
        403
      );
    }
  );

  await withApp(
    (app) =>
      registerPaymentConfigRoutes(app, authAs({ role: 'admin' }), {
        pool: mirrorPool(),
        getSharedState: async () => {
          throw new Error('boom');
        },
        resolveTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/payment-config')).status, 500);
    }
  );
});

// —— stores domain delete ——
test('stores domain routes: delete store', async () => {
  await withApp(
    (app) =>
      registerStoresDomainRoutes(app, authAs({ role: 'store_employee' }), {
        pool: mirrorPool({ stores: [{ id: 's1', name: 'A' }] }),
        resolveTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/stores/s1', { method: 'DELETE' })).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerStoresDomainRoutes(app, authAs({ role: 'admin' }), {
        pool: mirrorPool({ stores: [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }] }),
        resolveTenantId: () => 'default',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/stores/%20', { method: 'DELETE' })).status, 400);
      assert.equal((await jsonFetch(base, '/api/stores/missing', { method: 'DELETE' })).status, 404);
      const del = await jsonFetch(base, '/api/stores/s1', { method: 'DELETE' });
      assert.equal(del.status, 200);
      assert.equal(del.body.ok, true);
      assert.equal(del.body.removed.id, 's1');
    }
  );
});

// —— agent-records ——
test('agent-records routes: list + bind gates', async () => {
  const poolFn = () => ({
    query: async (sql, params) => {
      const s = String(sql);
      if (/UPDATE agent_issues/i.test(s)) return { rows: [{ id: params?.[0] }] };
      if (/INSERT INTO agent_appeals/i.test(s) || /RETURNING id/i.test(s)) {
        return { rows: [{ id: 'ap1' }] };
      }
      return { rows: [] };
    },
  });

  await withApp(
    (app) =>
      registerAgentRecordsRoutes(app, authAs({ role: 'store_employee', username: 'e1' }), {
        pool: poolFn,
        getSharedState: async () => ({ employees: [{ username: 'e1', store: 'S1' }] }),
        inferBrandFromStoreName: () => 'B',
        fetchStoreRatingForProfileDisplay: async () => ({ score: 1 }),
        calculateStoreRating: async () => ({}),
        registerFeishuUser: async () => ({ ok: true }),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/issues')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/scores')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/audits')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/appeals')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/messages')).status, 200);
      assert.equal((await jsonFetch(base, '/api/agents/feishu-users')).status, 403);
      assert.equal(
        (await jsonFetch(base, '/api/agents/feishu-users/bind', { method: 'POST', body: '{}' })).status,
        403
      );

      const me = await jsonFetch(base, '/api/agent-scores/me');
      // may 200 or domain-specific status depending on score rows
      assert.ok([200, 404].includes(me.status));

      const notif = await jsonFetch(base, '/api/hrms-notifications/me');
      assert.ok([200, 404].includes(notif.status));
    }
  );

  await withApp(
    (app) =>
      registerAgentRecordsRoutes(app, authAs({ role: 'admin', username: 'a1' }), {
        pool: poolFn,
        getSharedState: async () => ({}),
        inferBrandFromStoreName: () => null,
        fetchStoreRatingForProfileDisplay: async () => ({}),
        calculateStoreRating: async () => ({}),
        registerFeishuUser: async (openId, username) => ({ openId, username, bound: true }),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/feishu-users')).status, 200);
      assert.equal(
        (
          await jsonFetch(base, '/api/agents/feishu-users/bind', {
            method: 'POST',
            body: JSON.stringify({}),
          })
        ).status,
        400
      );
      const bind = await jsonFetch(base, '/api/agents/feishu-users/bind', {
        method: 'POST',
        body: JSON.stringify({ openId: 'ou_1', username: 'u1' }),
      });
      assert.equal(bind.status, 200);
      assert.equal(bind.body.bound, true);

      const appeal = await jsonFetch(base, '/api/agents/appeals', {
        method: 'POST',
        body: JSON.stringify({ reason: 'r' }),
      });
      assert.ok([200, 400].includes(appeal.status));

      const resolveMissing = await jsonFetch(base, '/api/agents/issues/%20/resolve', {
        method: 'POST',
        body: JSON.stringify({ resolution: 'x' }),
      });
      assert.ok([400, 404, 500].includes(resolveMissing.status));
    }
  );

  await withApp(
    (app) =>
      registerAgentRecordsRoutes(app, authAs({ role: 'admin', username: 'a1' }), {
        pool: () => ({
          query: async () => {
            throw new Error('db');
          },
        }),
        getSharedState: async () => ({}),
        inferBrandFromStoreName: () => null,
        fetchStoreRatingForProfileDisplay: async () => ({}),
        calculateStoreRating: async () => ({}),
        registerFeishuUser: async () => {
          throw new Error('bind');
        },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/issues')).status, 500);
      assert.equal((await jsonFetch(base, '/api/agents/feishu-users')).status, 500);
      assert.equal(
        (
          await jsonFetch(base, '/api/agents/feishu-users/bind', {
            method: 'POST',
            body: JSON.stringify({ openId: 'o', username: 'u' }),
          })
        ).status,
        500
      );
    }
  );
});
