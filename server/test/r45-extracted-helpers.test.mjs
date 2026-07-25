/**
 * R45：薄 routes（bitable-sync / menu-health / wechat-work / usage-weekly /
 * exam-results / permission-groups / attention-scores / attachments / kf /
 * payment-rules）挂 extracted 地板。
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerBitableSyncRoutes } from '../domains/bitable-sync/routes.js';
import { registerGrowthMenuHealthRoutes } from '../domains/growth-menu-health/routes.js';
import { registerGrowthWechatWorkRoutes } from '../domains/growth-wechat-work/routes.js';
import { registerUsageWeeklyRoutes } from '../domains/usage-weekly/routes.js';
import { registerExamResultsRoutes } from '../domains/exam-results/routes.js';
import { registerPermissionGroupsRoutes } from '../domains/permission-groups/routes.js';
import { registerAttentionScoresRoutes } from '../domains/attention-scores/routes.js';
import { registerEmployeeAttachmentsRoutes } from '../domains/employees/routes-attachments.js';
import { registerSalesAiKfRoutes } from '../domains/sales-ai/routes-kf.js';
import { registerGrowthPaymentRulesRoutes } from '../domains/growth-payment-rules/routes.js';

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
  return { status: res.status, body: await res.json().catch(() => ({})), text: null };
}

async function textFetch(base, path, opts = {}) {
  const res = await fetch(base + path, opts);
  return { status: res.status, text: await res.text() };
}

// —— bitable-sync ——
test('bitable-sync: role / names / ok / 500', async () => {
  await withApp(
    (app) =>
      registerBitableSyncRoutes(app, authAs({ role: 'store_employee' }), {
        pool: { query: async () => ({ rows: [] }) },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/bitable-sync')).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerBitableSyncRoutes(app, authAs({ role: 'admin', tenant_id: 't1' }), {
        pool: {
          query: async () => ({
            rows: [
              { table_id: 'tblpx5Efqc6eHo3L', cnt: '3', last_sync: '2026-07-01' },
              { table_id: 'tblUnknownXXXXXX', cnt: '1', last_sync: '2026-07-02' },
              { table_id: 'custom-name', cnt: '2', last_sync: '2026-07-03' },
              { table_id: '', cnt: '0', last_sync: null },
            ],
          }),
        },
      }),
    async (base) => {
      const r = await jsonFetch(base, '/api/agents/bitable-sync');
      assert.equal(r.status, 200);
      assert.equal(r.body.items[0].name, '桌访表');
      assert.ok(String(r.body.items[1].name).includes('未登记'));
      assert.equal(r.body.items[2].name, 'custom-name');
      assert.equal(r.body.items[3].name, '—');
    }
  );

  await withApp(
    (app) =>
      registerBitableSyncRoutes(app, authAs({ role: 'store_manager' }), {
        pool: { query: async () => { throw new Error('db'); } },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/agents/bitable-sync')).status, 500);
    }
  );
});

// —— menu-health ——
test('growth menu-health routes', async () => {
  const prev = process.env.MINIPROGRAM_SYNC_SECRET;
  process.env.MINIPROGRAM_SYNC_SECRET = 'mh-secret';
  try {
    await withApp(
      (app) =>
        registerGrowthMenuHealthRoutes(app, {
          pool: {
            query: async (sql) => {
              if (String(sql).includes('WITH cur') || String(sql).includes('pos_order_items')) {
                return { rows: [] };
              }
              if (String(sql).includes('INSERT') || String(sql).includes('RETURNING')) {
                return { rows: [{ report_month: '2026-07', store_code: 's1' }] };
              }
              return { rows: [{ report_month: '2026-07' }] };
            },
          },
          requirePhaseAuth: () => true,
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/menu-health-reports')).status, 200);
        assert.equal(
          (await jsonFetch(base, '/api/growth/menu-health-reports/bad')).status,
          400
        );
        assert.equal(
          (await jsonFetch(base, '/api/growth/menu-health-reports/2026-07')).status,
          200
        );
        assert.equal(
          (await jsonFetch(base, '/api/growth/menu-health-reports/generate', {
            method: 'POST',
            body: JSON.stringify({ store_code: 's1', report_month: '2026-07' }),
          })).status,
          401
        );
        const gen = await jsonFetch(base, '/api/growth/menu-health-reports/generate', {
          method: 'POST',
          headers: { 'x-miniprogram-sync-secret': 'mh-secret' },
          body: JSON.stringify({ store_code: 's1', report_month: '2026-07' }),
        });
        assert.equal(gen.status, 200);
        assert.equal(gen.body.ok, true);
      }
    );

    await withApp(
      (app) =>
        registerGrowthMenuHealthRoutes(app, {
          pool: { query: async () => { throw new Error('db'); } },
          requirePhaseAuth: (_req, res) => {
            res.status(401).json({ error: 'unauthorized' });
            return false;
          },
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/menu-health-reports')).status, 401);
      }
    );

    await withApp(
      (app) =>
        registerGrowthMenuHealthRoutes(app, {
          pool: { query: async () => { throw new Error('db'); } },
          requirePhaseAuth: () => true,
          getPhaseTenantId: () => 'default',
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/menu-health-reports')).status, 500);
        assert.equal(
          (await jsonFetch(base, '/api/growth/menu-health-reports/2026-07')).status,
          500
        );
        assert.equal(
          (await jsonFetch(base, '/api/growth/menu-health-reports/generate', {
            method: 'POST',
            headers: { 'x-miniprogram-sync-secret': 'mh-secret' },
            body: JSON.stringify({ report_month: '2026-07' }),
          })).status,
          500
        );
      }
    );
  } finally {
    if (prev === undefined) delete process.env.MINIPROGRAM_SYNC_SECRET;
    else process.env.MINIPROGRAM_SYNC_SECRET = prev;
  }
});

// —— wechat-work ——
test('growth wechat-work routes', async () => {
  await withApp(
    (app) =>
      registerGrowthWechatWorkRoutes(app, {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('UPDATE wechat_work_customers')) return { rowCount: 1, rows: [] };
            if (String(sql).includes('GROUP BY store_id')) {
              return { rows: [{ store_id: 's1', total: 2, bound: 1, unbound: 1 }] };
            }
            if (String(sql).includes('SELECT w.*')) {
              return { rows: [{ bind_customer_id: 1 }, { bind_customer_id: null }] };
            }
            return { rows: [], rowCount: 1 };
          },
        },
        requirePhaseAuth: () => true,
        getPhaseTenantId: () => 'default',
        resolveTenantIdForStore: async () => 'default',
        getFeishuBitableData: async () => ({
          data: { items: [{ fields: { phone: '13800138000', name: 'A', store_id: 's1' } }] },
        }),
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/growth/wechat-work/import-feishu', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );
      const imp = await jsonFetch(base, '/api/growth/wechat-work/import-feishu', {
        method: 'POST',
        body: JSON.stringify({ app_token: 'tok', table_id: 'tbl' }),
      });
      assert.equal(imp.status, 200);
      assert.equal(imp.body.ok, true);

      const man = await jsonFetch(base, '/api/growth/wechat-work/customers', {
        method: 'POST',
        body: JSON.stringify({ customers: [{ phone: '13900139000', store_id: 's1', name: 'B' }] }),
      });
      assert.equal(man.status, 200);
      assert.ok(man.body.imported >= 1);

      const list = await jsonFetch(base, '/api/growth/wechat-work/customers?store_id=s1');
      assert.equal(list.status, 200);
      assert.equal(list.body.total, 2);

      const st = await jsonFetch(base, '/api/growth/wechat-work/stats');
      assert.equal(st.status, 200);
      assert.equal(st.body.stats.length, 1);
    }
  );

  await withApp(
    (app) =>
      registerGrowthWechatWorkRoutes(app, {
        pool: { query: async () => { throw new Error('db'); } },
        requirePhaseAuth: (_req, res) => {
          res.status(401).json({ error: 'unauthorized' });
          return false;
        },
        getPhaseTenantId: () => 'default',
        resolveTenantIdForStore: async () => 'default',
        getFeishuBitableData: async () => ({}),
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/growth/wechat-work/stats')).status, 401);
    }
  );

  await withApp(
    (app) =>
      registerGrowthWechatWorkRoutes(app, {
        pool: {
          query: async (sql) => {
            // feishu empty import still runs matchBatch UPDATE
            if (String(sql).includes('UPDATE wechat_work_customers')) {
              return { rowCount: 0, rows: [] };
            }
            throw new Error('db');
          },
        },
        requirePhaseAuth: () => true,
        getPhaseTenantId: () => 'default',
        resolveTenantIdForStore: async () => 'default',
        getFeishuBitableData: async () => {
          throw new Error('feishu');
        },
      }),
    async (base) => {
      // feishu catch → empty records → matchBatch ok → 200
      const imp = await jsonFetch(base, '/api/growth/wechat-work/import-feishu', {
        method: 'POST',
        body: JSON.stringify({ app_token: 't', table_id: 't' }),
      });
      assert.equal(imp.status, 200);
      assert.equal(
        (await jsonFetch(base, '/api/growth/wechat-work/customers', {
          method: 'POST',
          body: JSON.stringify({ phone: '13800138000' }),
        })).status,
        500
      );
      assert.equal((await jsonFetch(base, '/api/growth/wechat-work/customers')).status, 500);
      assert.equal((await jsonFetch(base, '/api/growth/wechat-work/stats')).status, 500);
    }
  );
});

// —— usage-weekly ——
test('usage-weekly routes', async () => {
  await withApp(
    (app) =>
      registerUsageWeeklyRoutes(app, authAs({ role: 'store_employee' }), {
        pool: { query: async () => ({ rows: [] }) },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/admin/usage-weekly')).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerUsageWeeklyRoutes(app, authAs({ role: 'admin' }), {
        pool: {
          query: async (_sql, params) => {
            assert.ok(params[0]);
            assert.ok(params[1]);
            return { rows: [{ username: 'u1', login_count: '2', online_minutes: 10 }] };
          },
        },
      }),
    async (base) => {
      const r = await jsonFetch(base, '/api/admin/usage-weekly');
      assert.equal(r.status, 200);
      assert.ok(r.body.periodStart);
      assert.equal(r.body.data.length, 1);
    }
  );

  await withApp(
    (app) =>
      registerUsageWeeklyRoutes(app, authAs({ role: 'hq_manager' }), {
        pool: { query: async () => { throw new Error('db'); } },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/admin/usage-weekly')).status, 500);
    }
  );
});

// —— exam-results ——
test('exam-results routes', async () => {
  await withApp(
    (app) =>
      registerExamResultsRoutes(app, authAs({ role: 'admin', username: 'admin' }), {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('insert into exam_results')) {
              return { rows: [{ id: 1, score: 90, total: 10 }] };
            }
            return { rows: [{ id: 1, score: 80 }] };
          },
        },
      }),
    async (base) => {
      const list = await jsonFetch(base, '/api/exam-results?limit=10');
      assert.equal(list.status, 200);
      assert.equal(list.body.items.length, 1);

      assert.equal(
        (await jsonFetch(base, '/api/exam-results', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );
      const created = await jsonFetch(base, '/api/exam-results', {
        method: 'POST',
        body: JSON.stringify({
          assignmentId: 'a1',
          total: 10,
          correct: 9,
          score: 90,
          answers: [1, 2],
        }),
      });
      assert.equal(created.status, 200);
      assert.equal(created.body.item.score, 90);
    }
  );

  await withApp(
    (app) =>
      registerExamResultsRoutes(app, authAs({ role: 'store_employee', username: 'e1' }), {
        pool: {
          query: async (_sql, params) => {
            assert.equal(params[0], 'e1');
            return { rows: [{ id: 2 }] };
          },
        },
      }),
    async (base) => {
      const list = await jsonFetch(base, '/api/exam-results');
      assert.equal(list.status, 200);
      assert.equal(list.body.items[0].id, 2);
    }
  );

  await withApp(
    (app) =>
      registerExamResultsRoutes(app, authAs({ role: 'admin', username: 'a' }), {
        pool: { query: async () => { throw new Error('db'); } },
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/exam-results')).status, 500);
      assert.equal(
        (await jsonFetch(base, '/api/exam-results', {
          method: 'POST',
          body: JSON.stringify({ total: 1, score: 1 }),
        })).status,
        500
      );
    }
  );
});

// —— permission-groups ——
test('permission-groups routes', async () => {
  let state = {
    permissionGroups: [{ id: 'g1', name: 'G' }],
    employees: [{ username: 'e1', name: 'E1' }, { username: 'e2', name: 'E2' }],
  };
  const merges = [];

  await withApp(
    (app) =>
      registerPermissionGroupsRoutes(app, authAs({ role: 'admin', username: 'admin' }), {
        pool: { query: async () => ({ rows: [] }) },
        getSharedState: async () => state,
        saveSharedState: async (s) => { state = s; },
        mergeSharedStateFields: async (patch) => { merges.push(patch); },
      }),
    async (base) => {
      const g = await jsonFetch(base, '/api/permission-groups');
      assert.equal(g.status, 200);
      assert.equal(g.body.groups.length, 1);

      assert.equal(
        (await jsonFetch(base, '/api/permission-groups', {
          method: 'PUT',
          body: JSON.stringify({ groups: 'bad' }),
        })).status,
        400
      );
      const put = await jsonFetch(base, '/api/permission-groups', {
        method: 'PUT',
        body: JSON.stringify({ groups: [{ id: 'g2' }] }),
      });
      assert.equal(put.status, 200);

      assert.equal(
        (await jsonFetch(base, '/api/permission-groups/assign', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );
      assert.equal(
        (await jsonFetch(base, '/api/permission-groups/assign', {
          method: 'POST',
          body: JSON.stringify({ usernames: ['e1'] }),
        })).status,
        400
      );
      const assign = await jsonFetch(base, '/api/permission-groups/assign', {
        method: 'POST',
        body: JSON.stringify({
          usernames: ['e1', 'missing'],
          groupId: 'g2',
          storeScopeOverride: { stores: ['洪潮'] },
        }),
      });
      assert.equal(assign.status, 200);
      assert.equal(assign.body.updated, 1);
      assert.ok(merges.length >= 1);
    }
  );

  await withApp(
    (app) =>
      registerPermissionGroupsRoutes(app, authAs({ role: 'store_employee' }), {
        pool: { query: async () => ({ rows: [] }) },
        getSharedState: async () => state,
        saveSharedState: async () => {},
        mergeSharedStateFields: async () => {},
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/permission-groups', {
          method: 'PUT',
          body: JSON.stringify({ groups: [] }),
        })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/permission-groups/assign', {
          method: 'POST',
          body: JSON.stringify({ usernames: ['e1'], groupId: 'g' }),
        })).status,
        403
      );
    }
  );

  await withApp(
    (app) =>
      registerPermissionGroupsRoutes(app, authAs({ role: 'admin' }), {
        pool: { query: async () => { throw new Error('sync'); } },
        getSharedState: async () => { throw new Error('x'); },
        saveSharedState: async () => {},
        mergeSharedStateFields: async () => {},
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/permission-groups')).status, 500);
    }
  );
});

// —— attention-scores ——
test('attention-scores routes', async () => {
  await withApp(
    (app) =>
      registerAttentionScoresRoutes(app, authAs({ username: '', role: 'admin' }), {
        pool: { query: async () => ({ rows: [] }) },
        getSharedState: async () => ({}),
        resolveTenantIdDefault: () => 'default',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/attention-scores', {
          method: 'POST',
          body: JSON.stringify({ materialId: 'm1', score: 80 }),
        })).status,
        400
      );
    }
  );

  await withApp(
    (app) =>
      registerAttentionScoresRoutes(app, authAs({ username: 'e1', role: 'store_employee' }), {
        pool: {
          query: async (sql, params) => {
            if (String(sql).includes('INSERT')) return { rows: [] };
            assert.equal(params[0], 'e1');
            return { rows: [{ id: 'a1', score: 70 }] };
          },
        },
        getSharedState: async () => ({
          employees: [{ username: 'e1', name: 'E', store: '洪潮' }],
          users: [],
        }),
        resolveTenantIdDefault: () => 'default',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/attention-scores', {
          method: 'POST',
          body: JSON.stringify({ score: 80 }),
        })).status,
        400
      );
      const post = await jsonFetch(base, '/api/attention-scores', {
        method: 'POST',
        body: JSON.stringify({
          materialId: 'm1',
          materialTitle: 'T',
          score: 80,
          durationSeconds: 10,
          totalSamples: 5,
          attentiveSamples: 4,
          avgScore: 75,
        }),
      });
      assert.equal(post.status, 200);
      assert.equal(post.body.ok, true);

      const list = await jsonFetch(base, '/api/attention-scores');
      assert.equal(list.status, 200);
      assert.equal(list.body.scores.length, 1);

      assert.equal((await jsonFetch(base, '/api/attention-scores/summary')).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerAttentionScoresRoutes(app, authAs({ username: 'admin', role: 'admin' }), {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('GROUP BY')) {
              return { rows: [{ username: 'e1', avg_score: 60 }] };
            }
            return { rows: [{ id: 'x' }] };
          },
        },
        getSharedState: async () => ({ users: [], employees: [] }),
        resolveTenantIdDefault: () => 'default',
      }),
    async (base) => {
      const list = await jsonFetch(base, '/api/attention-scores?username=e1&materialId=m1&limit=10');
      assert.equal(list.status, 200);
      const sum = await jsonFetch(base, '/api/attention-scores/summary');
      assert.equal(sum.status, 200);
      assert.equal(sum.body.summary.length, 1);
    }
  );

  await withApp(
    (app) =>
      registerAttentionScoresRoutes(app, authAs({ username: 'a', role: 'admin' }), {
        pool: { query: async () => { throw new Error('db'); } },
        getSharedState: async () => ({}),
        resolveTenantIdDefault: () => 'default',
      }),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/attention-scores', {
          method: 'POST',
          body: JSON.stringify({ materialId: 'm' }),
        })).status,
        500
      );
      assert.equal((await jsonFetch(base, '/api/attention-scores')).status, 500);
      assert.equal((await jsonFetch(base, '/api/attention-scores/summary')).status, 500);
    }
  );
});

// —— employee attachments ——
test('employee attachments routes', async () => {
  await withApp(
    (app) => {
      const r = express.Router();
      registerEmployeeAttachmentsRoutes(r, authAs({ role: 'store_employee' }), {
        pool: { query: async () => ({ rows: [] }) },
        upload: { single: () => (_req, _res, next) => next() },
        recordUploadOwnership: async () => {},
        uploadsDir: '/tmp',
        resolveTenantIdDefault: () => 'default',
      });
      app.use('/api/employees', r);
    },
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/employees/e1/attachments')).status, 403);
    }
  );

  await withApp(
    (app) => {
      const r = express.Router();
      registerEmployeeAttachmentsRoutes(r, authAs({ role: 'admin', username: 'admin' }), {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('insert into employee_attachments')) {
              return { rows: [{ id: 1, filename: 'f.png' }] };
            }
            if (String(sql).includes('delete from employee_attachments')) {
              return { rowCount: 1, rows: [{ filename: 'f.png' }] };
            }
            return { rows: [{ id: 1 }] };
          },
        },
        upload: {
          single: () => (req, _res, next) => {
            if (req.headers['x-has-file'] === '1') {
              req.file = { filename: 'f.png', originalname: 'o.png', size: 100 };
            }
            if (req.headers['x-big-file'] === '1') {
              req.file = { filename: 'big.bin', originalname: 'b', size: 21 * 1024 * 1024 };
            }
            next();
          },
        },
        recordUploadOwnership: async () => {},
        uploadsDir: '/tmp',
        resolveTenantIdDefault: () => 'default',
      });
      app.use('/api/employees', r);
    },
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/employees/%20/attachments')).status, 400);
      const list = await jsonFetch(base, '/api/employees/e1/attachments');
      assert.equal(list.status, 200);

      assert.equal(
        (await jsonFetch(base, '/api/employees/e1/attachments', { method: 'POST' })).status,
        400
      );
      assert.equal(
        (await jsonFetch(base, '/api/employees/e1/attachments', {
          method: 'POST',
          headers: { 'x-big-file': '1' },
        })).status,
        400
      );
      const up = await jsonFetch(base, '/api/employees/e1/attachments', {
        method: 'POST',
        headers: { 'x-has-file': '1' },
        body: JSON.stringify({ description: 'd' }),
      });
      assert.equal(up.status, 200);
      assert.equal(up.body.filename, 'f.png');

      assert.equal(
        (await jsonFetch(base, '/api/employees/e1/attachments/%20', { method: 'DELETE' })).status,
        400
      );
      const del = await jsonFetch(base, '/api/employees/e1/attachments/1', { method: 'DELETE' });
      assert.equal(del.status, 200);
    }
  );

  await withApp(
    (app) => {
      const r = express.Router();
      registerEmployeeAttachmentsRoutes(r, authAs({ role: 'hr_manager' }), {
        pool: {
          query: async (sql) => {
            if (String(sql).includes('delete')) return { rowCount: 0, rows: [] };
            throw new Error('db');
          },
        },
        upload: { single: () => (_req, _res, next) => next() },
        recordUploadOwnership: async () => {},
        uploadsDir: '/tmp',
        resolveTenantIdDefault: () => 'default',
      });
      app.use('/api/employees', r);
    },
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/employees/e1/attachments')).status, 500);
      assert.equal(
        (await jsonFetch(base, '/api/employees/e1/attachments/9', { method: 'DELETE' })).status,
        404
      );
    }
  );
});

// —— sales-ai kf callback ——
test('sales-ai kf callback: plaintext / ok / post without config', async () => {
  const prev = {
    token: process.env.WECOM_KF_TOKEN,
    aes: process.env.WECOM_KF_AES_KEY,
    corp: process.env.WECOM_KF_CORP_ID,
    secret: process.env.WECOM_KF_SECRET,
    open: process.env.WECOM_KF_OPEN_KFID,
  };
  delete process.env.WECOM_KF_TOKEN;
  delete process.env.WECOM_KF_AES_KEY;
  delete process.env.WECOM_KF_CORP_ID;
  delete process.env.WECOM_KF_SECRET;
  delete process.env.WECOM_KF_OPEN_KFID;
  try {
    await withApp(
      (app) => registerSalesAiKfRoutes({ app, pool: { query: async () => ({ rows: [] }) } }),
      async (base) => {
        const plain = await textFetch(base, '/api/wecom/kf/callback?echostr=hello');
        assert.equal(plain.status, 200);
        assert.equal(plain.text, 'hello');
        const ok = await textFetch(base, '/api/wecom/kf/callback');
        assert.equal(ok.text, 'ok');
        const post = await textFetch(base, '/api/wecom/kf/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        assert.equal(post.status, 200);
        assert.equal(post.text, 'success');
      }
    );
  } finally {
    for (const [k, v] of Object.entries({
      WECOM_KF_TOKEN: prev.token,
      WECOM_KF_AES_KEY: prev.aes,
      WECOM_KF_CORP_ID: prev.corp,
      WECOM_KF_SECRET: prev.secret,
      WECOM_KF_OPEN_KFID: prev.open,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  process.env.WECOM_KF_TOKEN = 'tok';
  process.env.WECOM_KF_AES_KEY = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  process.env.WECOM_KF_CORP_ID = 'corp';
  process.env.WECOM_KF_SECRET = 'sec';
  process.env.WECOM_KF_OPEN_KFID = 'kfid';
  try {
    await withApp(
      (app) => registerSalesAiKfRoutes({ app, pool: { query: async () => ({ rows: [] }) } }),
      async (base) => {
        const bad = await textFetch(
          base,
          '/api/wecom/kf/callback?msg_signature=bad&timestamp=1&nonce=n&echostr=enc'
        );
        assert.equal(bad.status, 401);
        const arr = ['tok', '1', 'n', 'enc'].sort();
        const sig = createHash('sha1').update(arr.join('')).digest('hex');
        const decFail = await textFetch(
          base,
          `/api/wecom/kf/callback?msg_signature=${sig}&timestamp=1&nonce=n&echostr=enc`
        );
        assert.equal(decFail.status, 400);

        // POST：已配置 KF；签名失败早退
        const postBadSig = await textFetch(
          base,
          '/api/wecom/kf/callback?msg_signature=bad&timestamp=1&nonce=n',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ Encrypt: 'enc' }),
          }
        );
        assert.equal(postBadSig.status, 200);
        assert.equal(postBadSig.text, 'success');

        // POST：签名通过但密文无效 → decrypt catch
        const postSig = createHash('sha1').update(['tok', '1', 'n', 'enc'].sort().join('')).digest('hex');
        const postDec = await textFetch(
          base,
          `/api/wecom/kf/callback?msg_signature=${postSig}&timestamp=1&nonce=n`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ Encrypt: 'enc', Token: 't1' }),
          }
        );
        assert.equal(postDec.status, 200);
        assert.equal(postDec.text, 'success');

        const postPlain = await textFetch(base, '/api/wecom/kf/callback', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ Token: 't2' }),
        });
        assert.equal(postPlain.status, 200);
        assert.equal(postPlain.text, 'success');
      }
    );
  } finally {
    for (const [k, v] of Object.entries({
      WECOM_KF_TOKEN: prev.token,
      WECOM_KF_AES_KEY: prev.aes,
      WECOM_KF_CORP_ID: prev.corp,
      WECOM_KF_SECRET: prev.secret,
      WECOM_KF_OPEN_KFID: prev.open,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// —— payment-rules (growth-api auth via sync secret) ——
test('growth payment-rules routes', async () => {
  const prev = process.env.MINIPROGRAM_SYNC_SECRET;
  process.env.MINIPROGRAM_SYNC_SECRET = 'pr-secret';
  const authHeaders = { 'x-miniprogram-sync-secret': 'pr-secret' };
  try {
    await withApp(
      (app) =>
        registerGrowthPaymentRulesRoutes(app, {
          query: async (sql) => {
            if (String(sql).includes('DELETE FROM marketing_payment_rules')) {
              return { rowCount: 1, rows: [{ rule_key: 'r1' }] };
            }
            if (String(sql).includes('INSERT') || String(sql).includes('ON CONFLICT')) {
              return { rows: [{ rule_key: 'r1', active: true }] };
            }
            return { rows: [{ rule_key: 'r1', active: true }] };
          },
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/payment-rules')).status, 401);
        const list = await jsonFetch(base, '/api/growth/payment-rules', { headers: authHeaders });
        assert.equal(list.status, 200);

        const upsert = await jsonFetch(base, '/api/growth/payment-rules', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            rule_key: 'r1',
            name: 'N',
            store_id: 's1',
            member_template_id: 'tpl1',
          }),
        });
        assert.equal(upsert.status, 200);

        const del = await jsonFetch(base, '/api/growth/payment-rules/r1', {
          method: 'DELETE',
          headers: authHeaders,
        });
        assert.equal(del.status, 200);

        const sync = await jsonFetch(base, '/api/growth/payment-rules/sync', {
          headers: authHeaders,
        });
        assert.equal(sync.status, 200);
      }
    );

    await withApp(
      (app) =>
        registerGrowthPaymentRulesRoutes(app, {
          query: async () => { throw new Error('db'); },
        }),
      async (base) => {
        assert.equal(
          (await jsonFetch(base, '/api/growth/payment-rules', { headers: authHeaders })).status,
          500
        );
        // 校验失败走 400；带齐字段后才会打到 DB 500
        assert.equal(
          (await jsonFetch(base, '/api/growth/payment-rules', {
            method: 'POST',
            headers: authHeaders,
            body: '{}',
          })).status,
          400
        );
        assert.equal(
          (await jsonFetch(base, '/api/growth/payment-rules', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              store_id: 's1',
              name: 'N',
              member_template_id: 'tpl',
            }),
          })).status,
          500
        );
        assert.equal(
          (await jsonFetch(base, '/api/growth/payment-rules/x', {
            method: 'DELETE',
            headers: authHeaders,
          })).status,
          500
        );
        assert.equal(
          (await jsonFetch(base, '/api/growth/payment-rules/sync', { headers: authHeaders })).status,
          500
        );
      }
    );
  } finally {
    if (prev === undefined) delete process.env.MINIPROGRAM_SYNC_SECRET;
    else process.env.MINIPROGRAM_SYNC_SECRET = prev;
  }
});
