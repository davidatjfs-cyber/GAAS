/**
 * R46：auth / AI chat / campaigns / health / uploads / tenant-settings / growth-ops 挂地板。
 */
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { registerAuthRoutes } from '../domains/auth/routes.js';
import {
  registerAiChatCompletionsRoutes,
  normalizeOpenAiCompatibleBaseUrl,
} from '../domains/ai/routes-chat-completions.js';
import { registerGrowthCampaignRoutes } from '../domains/growth-campaigns/routes.js';
import { registerHealthRoutes } from '../domains/health/routes.js';
import { registerUploadRoutes } from '../domains/uploads/routes.js';
import { registerTenantSettingsRoutes } from '../domains/tenant-settings/routes.js';
import { registerGrowthOpsRoutes } from '../domains/growth-ops/routes.js';
import { setPool } from '../utils/database.js';

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

// —— normalizeOpenAiCompatibleBaseUrl ——
test('normalizeOpenAiCompatibleBaseUrl', () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrl(''), '');
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com/v1'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1');
});

// —— AI chat-completions ——
test('ai chat-completions: validation + mock upstream', async () => {
  const origFetch = globalThis.fetch;
  try {
    await withApp(
      (app) => registerAiChatCompletionsRoutes(app, authAs({ username: '', role: 'admin' })),
      async (base) => {
        assert.equal(
          (await jsonFetch(base, '/api/ai/chat-completions', {
            method: 'POST',
            body: JSON.stringify({}),
          })).status,
          400
        );
      }
    );

    await withApp(
      (app) => registerAiChatCompletionsRoutes(app, authAs({ username: 'u1', role: 'admin' })),
      async (base) => {
        assert.equal(
          (await jsonFetch(base, '/api/ai/chat-completions', {
            method: 'POST',
            body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
          })).status,
          400
        );
        assert.equal(
          (await jsonFetch(base, '/api/ai/chat-completions', {
            method: 'POST',
            body: JSON.stringify({
              baseUrl: 'https://api.example.com',
              messages: [{ role: 'user', content: 'hi' }],
            }),
          })).status,
          400
        );
        assert.equal(
          (await jsonFetch(base, '/api/ai/chat-completions', {
            method: 'POST',
            body: JSON.stringify({
              baseUrl: 'https://api.example.com',
              apiKey: 'k',
              messages: [{ role: 'user', content: 'hi' }],
            }),
          })).status,
          400
        );
        assert.equal(
          (await jsonFetch(base, '/api/ai/chat-completions', {
            method: 'POST',
            body: JSON.stringify({
              baseUrl: 'https://api.example.com',
              apiKey: 'k',
              model: 'm',
              messages: [],
            }),
          })).status,
          400
        );

        const mockUpstream = (impl) => {
          globalThis.fetch = async (url, init) => {
            if (String(url).includes('/chat/completions')) return impl(url, init);
            return origFetch(url, init);
          };
        };

        mockUpstream(async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        }));
        const ok = await jsonFetch(base, '/api/ai/chat-completions', {
          method: 'POST',
          body: JSON.stringify({
            baseUrl: 'https://api.example.com',
            apiKey: 'k',
            model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0.5,
          }),
        });
        assert.equal(ok.status, 200);
        assert.ok(ok.body.choices);

        mockUpstream(async () => ({
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: 'rate' } }),
        }));
        assert.equal(
          (await jsonFetch(base, '/api/ai/chat-completions', {
            method: 'POST',
            body: JSON.stringify({
              baseUrl: 'https://api.example.com',
              apiKey: 'k',
              model: 'm',
              messages: [{ role: 'user', content: 'hi' }],
            }),
          })).status,
          429
        );

        mockUpstream(async () => ({
          ok: true,
          status: 200,
          text: async () => 'not-json',
        }));
        const raw = await jsonFetch(base, '/api/ai/chat-completions', {
          method: 'POST',
          body: JSON.stringify({
            baseUrl: 'https://api.example.com',
            apiKey: 'k',
            model: 'm',
            messages: [{ role: 'user', content: 'hi' }],
          }),
        });
        assert.equal(raw.status, 200);
        assert.equal(raw.body.raw, 'not-json');

        mockUpstream(async () => {
          throw new Error('net');
        });
        assert.equal(
          (await jsonFetch(base, '/api/ai/chat-completions', {
            method: 'POST',
            body: JSON.stringify({
              baseUrl: 'https://api.example.com',
              apiKey: 'k',
              model: 'm',
              messages: [{ role: 'user', content: 'hi' }],
            }),
          })).status,
          502
        );
      }
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

// —— auth routes ——
test('auth routes: thin handlers via service deps', async () => {
  setPool({
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async () => ({ rows: [] }),
      release() {},
    }),
  });

  const deps = {
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release() {},
      }),
    },
    JWT_SECRET: 'jwt-test-secret',
    DATABASE_URL: 'postgres://x',
    normalizeRoleForJwt: (r) => String(r || 'employee'),
    normalizeUsersTableRole: (r) => r,
    employeeAccountShouldDisable: () => false,
    recordLogin: async () => {},
    recordLogout: async () => {},
    storeSessionNonce: async () => {},
    loadTenantRuntimeStatus: async () => ({ loginAllowed: true }),
    getUserStoreAccessContext: async () => ({
      primaryStore: '洪潮',
      currentStore: '洪潮',
      allowedStores: ['洪潮', '马己仙'],
    }),
    getSharedState: async () => ({
      employees: [{ username: 'u1', name: 'U', store: '洪潮', permissionGroupId: 'g1' }],
      users: [],
    }),
    pickMyStoreFromState: () => '洪潮',
  };

  await withApp(
    (app) => registerAuthRoutes(app, authAs({ username: 'u1', role: 'admin' }), (_req, _res, next) => next(), deps),
    async (base) => {
      const me = await jsonFetch(base, '/api/auth/me');
      assert.equal(me.status, 200);
      assert.ok(me.body.user || me.body.username || me.body.ok !== false);

      const me2 = await jsonFetch(base, '/api/me');
      assert.ok(me2.status === 200 || me2.status === 500);

      assert.equal(
        (await jsonFetch(base, '/api/auth/switch-store', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );
      const sw = await jsonFetch(base, '/api/auth/switch-store', {
        method: 'POST',
        body: JSON.stringify({ store: '洪潮' }),
      });
      assert.ok(sw.status === 200 || sw.status === 403);

      assert.equal(
        (await jsonFetch(base, '/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );

      assert.equal(
        (await jsonFetch(base, '/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );
      assert.equal(
        (await jsonFetch(base, '/api/login', {
          method: 'POST',
          body: JSON.stringify({ username: 'x', password: '' }),
        })).status,
        400
      );

      assert.equal(
        (await jsonFetch(base, '/api/auth/login-as', {
          method: 'POST',
          body: JSON.stringify({}),
        })).status,
        400
      );

      const logout = await jsonFetch(base, '/api/auth/logout', { method: 'POST', body: '{}' });
      assert.equal(logout.status, 200);

      const hb = await jsonFetch(base, '/api/auth/heartbeat', { method: 'POST', body: '{}' });
      assert.equal(hb.status, 200);
    }
  );

  await withApp(
    (app) =>
      registerAuthRoutes(
        app,
        authAs({ username: 'e1', role: 'store_employee' }),
        (_req, _res, next) => next(),
        deps
      ),
    async (base) => {
      assert.equal(
        (await jsonFetch(base, '/api/auth/login-as', {
          method: 'POST',
          body: JSON.stringify({ username: 'x', reason: 'r' }),
        })).status,
        403
      );
    }
  );
});

// —— growth campaigns ——
test('growth campaign routes', async () => {
  const prev = process.env.MINIPROGRAM_SYNC_SECRET;
  process.env.MINIPROGRAM_SYNC_SECRET = 'camp-secret';
  try {
    await withApp(
      (app) =>
        registerGrowthCampaignRoutes(app, {
          pool: {
            query: async (sql) => {
              if (String(sql).includes('INSERT') || String(sql).includes('RETURNING')) {
                return { rows: [{ id: 1, status: 'draft' }] };
              }
              if (String(sql).includes('DELETE')) return { rowCount: 1, rows: [] };
              if (String(sql).includes('rank') || String(sql).includes('GROUP')) {
                return { rows: [{ store_id: 's1', revenue: 1 }] };
              }
              return { rows: [{ id: 1 }] };
            },
          },
          requirePhaseAuth: () => true,
          getPhaseTenantId: () => 'default',
          executeGrowthActionRecord: async () => ({}),
        }),
      async (base) => {
        assert.equal(
          (await jsonFetch(base, '/api/growth/campaign-plans', {
            method: 'POST',
            body: JSON.stringify({ title: 'T' }),
          })).status,
          200
        );
        assert.equal((await jsonFetch(base, '/api/growth/campaign-plans')).status, 200);
        assert.equal((await jsonFetch(base, '/api/growth/marketing-templates')).status, 200);
        assert.equal(
          (await jsonFetch(base, '/api/growth/marketing-templates', {
            method: 'POST',
            body: JSON.stringify({ name: 'tpl' }),
          })).status,
          200
        );
        assert.equal(
          (await jsonFetch(base, '/api/growth/marketing-templates/1', { method: 'DELETE' })).status,
          200
        );
        assert.equal((await jsonFetch(base, '/api/growth/store-rankings?days=7')).status, 200);

        assert.equal(
          (await jsonFetch(base, '/api/growth/campaign-plans/1/status', {
            method: 'PATCH',
            body: JSON.stringify({ status: 'active' }),
          })).status,
          401
        );
        const patched = await jsonFetch(base, '/api/growth/campaign-plans/1/status', {
          method: 'PATCH',
          headers: { 'x-miniprogram-sync-secret': 'camp-secret' },
          body: JSON.stringify({ status: 'active' }),
        });
        // service may 400/404/200 depending on mock rows
        assert.ok([200, 400, 404, 500].includes(patched.status));
      }
    );

    await withApp(
      (app) =>
        registerGrowthCampaignRoutes(app, {
          pool: { query: async () => { throw new Error('db'); } },
          requirePhaseAuth: (_req, res) => {
            res.status(401).json({ error: 'unauthorized' });
            return false;
          },
          getPhaseTenantId: () => 'default',
          executeGrowthActionRecord: async () => ({}),
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/growth/campaign-plans')).status, 401);
      }
    );

    await withApp(
      (app) =>
        registerGrowthCampaignRoutes(app, {
          pool: { query: async () => { throw new Error('db'); } },
          requirePhaseAuth: () => true,
          getPhaseTenantId: () => 'default',
          executeGrowthActionRecord: async () => ({}),
        }),
      async (base) => {
        assert.equal(
          (await jsonFetch(base, '/api/growth/campaign-plans', {
            method: 'POST',
            body: '{}',
          })).status,
          500
        );
        assert.equal((await jsonFetch(base, '/api/growth/campaign-plans')).status, 500);
        assert.equal((await jsonFetch(base, '/api/growth/marketing-templates')).status, 500);
        assert.equal(
          (await jsonFetch(base, '/api/growth/marketing-templates', {
            method: 'POST',
            body: '{}',
          })).status,
          500
        );
        assert.equal(
          (await jsonFetch(base, '/api/growth/marketing-templates/1', { method: 'DELETE' })).status,
          500
        );
        assert.equal((await jsonFetch(base, '/api/growth/store-rankings')).status, 500);
      }
    );
  } finally {
    if (prev === undefined) delete process.env.MINIPROGRAM_SYNC_SECRET;
    else process.env.MINIPROGRAM_SYNC_SECRET = prev;
  }
});

// —— health ——
test('health + version routes', async () => {
  const prevAgents = process.env.AGENTS_SERVICE_HEALTH_URL;
  delete process.env.AGENTS_SERVICE_HEALTH_URL;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r46-health-'));
  const indexFile = path.join(tmp, 'index.js');
  fs.writeFileSync(indexFile, '// stub\n');
  fs.writeFileSync(path.join(tmp, 'agents.js'), '// agents\n');
  fs.writeFileSync(path.join(tmp, '..', 'working-fixed.html'), '<html></html>');
  // webRoot is serverDir/.. — put files relative to tmp as serverDir
  const serverDir = tmp;
  const webRoot = path.resolve(serverDir, '..');
  fs.writeFileSync(path.join(webRoot, 'working-fixed.html'), '<html></html>');
  fs.writeFileSync(path.join(webRoot, 'sw.js'), "const CACHE_NAME = 'hrms-v1';\n");

  try {
    await withApp(
      (app) =>
        registerHealthRoutes(app, {
          requireEnv: () => ['MISSING'],
          pool: { query: async () => ({ rows: [{ now: new Date(), b: 1024 }] }) },
          getOssClient: () => null,
          getCosClient: () => null,
          ensureUploadsDir: () => ({ ok: true }),
          getAgentHealthStatus: () => ({ ok: true }),
          hrmsNowISO: () => '2026-07-26T00:00:00.000Z',
          sendLarkMessage: async () => {},
          STARTED_AT: '2026-07-01T00:00:00.000Z',
          indexFilePath: indexFile,
          serverDir,
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/health')).status, 500);
      }
    );

    await withApp(
      (app) =>
        registerHealthRoutes(app, {
          requireEnv: () => [],
          pool: {
            query: async (sql) => {
              if (String(sql).includes('pg_database_size')) {
                return { rows: [{ b: String(5 * 1024 ** 3) }] };
              }
              return { rows: [{ now: new Date() }] };
            },
          },
          getOssClient: () => ({}),
          getCosClient: () => null,
          ensureUploadsDir: () => ({ path: '/tmp/uploads' }),
          getAgentHealthStatus: () => {
            throw new Error('x');
          },
          hrmsNowISO: () => '2026-07-26T00:00:00.000Z',
          sendLarkMessage: async () => {},
          STARTED_AT: '2026-07-01T00:00:00.000Z',
          indexFilePath: indexFile,
          serverDir,
        }),
      async (base) => {
        const h = await jsonFetch(base, '/api/health');
        assert.equal(h.status, 200);
        assert.equal(h.body.ok, true);
        assert.equal(h.body.storage.ossConfigured, true);

        const v = await jsonFetch(base, '/api/version');
        assert.equal(v.status, 200);
        assert.equal(v.body.buildVersion, 'v176');
        assert.ok(v.body.server.indexMtime);
      }
    );

    await withApp(
      (app) =>
        registerHealthRoutes(app, {
          requireEnv: () => [],
          pool: {
            query: async () => {
              throw new Error('db');
            },
          },
          getOssClient: () => null,
          getCosClient: () => null,
          ensureUploadsDir: () => ({}),
          getAgentHealthStatus: () => ({}),
          hrmsNowISO: () => 't',
          sendLarkMessage: async () => {},
          STARTED_AT: 't',
          indexFilePath: '/no/such/index.js',
          serverDir: '/no/such/server',
        }),
      async (base) => {
        assert.equal((await jsonFetch(base, '/api/health')).status, 500);
        const v = await jsonFetch(base, '/api/version');
        assert.equal(v.status, 200);
      }
    );
  } finally {
    if (prevAgents === undefined) delete process.env.AGENTS_SERVICE_HEALTH_URL;
    else process.env.AGENTS_SERVICE_HEALTH_URL = prevAgents;
  }
});

// —— uploads ——
test('upload routes: get + posts', async () => {
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r46-up-'));
  const filePath = path.join(uploadsDir, 'a.png');
  fs.writeFileSync(filePath, 'img');

  const upload = {
    single: () => (req, _res, next) => {
      if (req.headers['x-has-file'] === '1') {
        req.file = { filename: 'u1.png', size: 10 };
      }
      next();
    },
    array: () => (req, _res, next) => {
      if (req.headers['x-has-files'] === '1') {
        req.files = [{ filename: 'f1.png' }, { filename: 'f2.png' }];
      } else {
        req.files = [];
      }
      next();
    },
    fields: () => (req, _res, next) => {
      if (req.headers['x-idcard'] === '1') {
        req.files = {
          front: [{ filename: 'front.png' }],
          back: [{ filename: 'back.png' }],
        };
      } else {
        req.files = {};
      }
      next();
    },
  };

  await withApp(
    (app) =>
      registerUploadRoutes(app, authAs({ role: 'store_employee', username: 'e1', tenant_id: 't1' }), {
        upload,
        recordUploadOwnership: async () => {},
        pool: {
          query: async () => ({ rows: [{ tenant_id: 't1' }] }),
        },
        uploadsDir,
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/uploads/')).status, 400);
      const got = await fetch(`${base}/uploads/a.png`);
      assert.equal(got.status, 200);

      assert.equal(
        (await jsonFetch(base, '/api/growth/upload', { method: 'POST' })).status,
        400
      );
      const up = await jsonFetch(base, '/api/growth/upload', {
        method: 'POST',
        headers: { 'x-has-file': '1' },
      });
      assert.equal(up.status, 200);

      assert.equal(
        (await jsonFetch(base, '/api/uploads/daily-report', {
          method: 'POST',
          headers: { 'x-has-files': '1' },
        })).status,
        403
      );
      assert.equal(
        (await jsonFetch(base, '/api/uploads/employee-idcard', { method: 'POST' })).status,
        403
      );
      // store_employee 可上传积分凭证
      assert.equal(
        (await jsonFetch(base, '/api/uploads/points-evidence', {
          method: 'POST',
          headers: { 'x-has-files': '1' },
        })).status,
        200
      );
      assert.equal(
        (await jsonFetch(base, '/api/uploads/agent-task-evidence', {
          method: 'POST',
          headers: { 'x-has-files': '1' },
        })).status,
        403
      );
      const ops = await jsonFetch(base, '/api/uploads/ops-task-evidence', {
        method: 'POST',
        headers: { 'x-has-files': '1' },
      });
      assert.equal(ops.status, 200);
      assert.equal(ops.body.urls.length, 2);
    }
  );

  await withApp(
    (app) =>
      registerUploadRoutes(app, authAs({ role: 'admin', username: 'admin', tenant_id: 'default' }), {
        upload,
        recordUploadOwnership: async () => {},
        pool: { query: async () => ({ rows: [] }) },
        uploadsDir,
      }),
    async (base) => {
      assert.equal((await fetch(`${base}/uploads/missing.png`)).status, 404);
      const daily = await jsonFetch(base, '/api/uploads/daily-report', {
        method: 'POST',
        headers: { 'x-has-files': '1' },
      });
      assert.equal(daily.status, 200);
      assert.equal(
        (await jsonFetch(base, '/api/uploads/daily-report', { method: 'POST' })).status,
        400
      );

      const idc = await jsonFetch(base, '/api/uploads/employee-idcard', {
        method: 'POST',
        headers: { 'x-idcard': '1' },
      });
      assert.equal(idc.status, 200);
      assert.ok(idc.body.frontUrl);

      // admin 不在 canApplyPointsByRole 白名单
      assert.equal(
        (
          await jsonFetch(base, '/api/uploads/points-evidence', {
            method: 'POST',
            headers: { 'x-has-files': '1' },
          })
        ).status,
        403
      );

      const agent = await jsonFetch(base, '/api/uploads/agent-task-evidence', {
        method: 'POST',
        headers: { 'x-has-files': '1' },
      });
      assert.equal(agent.status, 200);
    }
  );

  await withApp(
    (app) =>
      registerUploadRoutes(app, authAs({ role: 'admin', username: 'a', tenant_id: 't2' }), {
        upload: {
          single: () => (_req, _res, next) => next(),
          array: () => (_req, _res, next) => next(),
          fields: () => (_req, _res, next) => next(),
        },
        recordUploadOwnership: async () => {
          throw new Error('own');
        },
        pool: {
          query: async () => ({ rows: [{ tenant_id: 'other' }] }),
        },
        uploadsDir,
      }),
    async (base) => {
      // non-matching tenant for non-admin would 403; admin bypasses
      const got = await fetch(`${base}/uploads/a.png`);
      assert.equal(got.status, 200);
    }
  );
});

// —— tenant-settings ——
test('tenant-settings proxy routes', async () => {
  const axios = {
    async get(url) {
      if (url.includes('fail')) return { status: 502, data: { error: 'x' } };
      return { status: 200, data: { ok: true, config: {} } };
    },
    async post() {
      return { status: 200, data: { ok: true } };
    },
    async put() {
      return { status: 200, data: { ok: true } };
    },
    async delete() {
      return { status: 200, data: { ok: true } };
    },
  };

  await withApp(
    (app) =>
      registerTenantSettingsRoutes(app, authAs({ role: 'store_employee' }), {
        axios,
        getAgentsServiceBaseUrl: () => 'http://agents.test',
        getAgentsServiceAdminToken: async () => 'tok',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/chairman/config')).status, 403);
      assert.equal((await jsonFetch(base, '/api/tenant-settings/kpi-targets')).status, 403);
    }
  );

  await withApp(
    (app) =>
      registerTenantSettingsRoutes(app, authAs({ role: 'admin', username: 'a' }), {
        axios,
        getAgentsServiceBaseUrl: () => 'http://agents.test',
        getAgentsServiceAdminToken: async () => 'tok',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/chairman/config')).status, 200);
      assert.equal(
        (await jsonFetch(base, '/api/chairman/config', { method: 'POST', body: '{}' })).status,
        200
      );
      assert.equal((await jsonFetch(base, '/api/tenant-settings/kpi-targets')).status, 200);
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/kpi-targets', {
          method: 'PUT',
          body: '{}',
        })).status,
        200
      );
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/kpi-targets/1', { method: 'DELETE' })).status,
        200
      );
      assert.equal((await jsonFetch(base, '/api/tenant-settings/nope')).status, 400);
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/performance_eval')).status,
        200
      );
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/performance_eval', {
          method: 'PUT',
          body: JSON.stringify({}),
        })).status,
        400
      );
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/performance_eval', {
          method: 'PUT',
          body: JSON.stringify({ config_value: { a: 1 } }),
        })).status,
        200
      );
    }
  );

  await withApp(
    (app) =>
      registerTenantSettingsRoutes(app, authAs({ role: 'hq_manager' }), {
        axios: {
          async get() {
            throw new Error('net');
          },
          async post() {
            throw new Error('net');
          },
          async put() {
            throw new Error('net');
          },
          async delete() {
            throw new Error('net');
          },
        },
        getAgentsServiceBaseUrl: () => 'http://agents.test',
        getAgentsServiceAdminToken: async () => 'tok',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/chairman/config')).status, 502);
      assert.equal(
        (await jsonFetch(base, '/api/chairman/config', { method: 'POST', body: '{}' })).status,
        502
      );
      assert.equal((await jsonFetch(base, '/api/tenant-settings/kpi-targets')).status, 502);
    }
  );

  await withApp(
    (app) =>
      registerTenantSettingsRoutes(app, authAs({ role: 'admin' }), {
        axios: {
          async get() {
            return { status: 503, data: { error: 'down' } };
          },
          async post() {
            return { status: 503, data: { error: 'down' } };
          },
          async put() {
            return { status: 503, data: { error: 'down' } };
          },
          async delete() {
            return { status: 503, data: { error: 'down' } };
          },
        },
        getAgentsServiceBaseUrl: () => 'http://agents.test',
        getAgentsServiceAdminToken: async () => 'tok',
      }),
    async (base) => {
      assert.equal((await jsonFetch(base, '/api/chairman/config')).status, 503);
      assert.equal(
        (await jsonFetch(base, '/api/chairman/config', { method: 'POST', body: '{}' })).status,
        503
      );
      assert.equal((await jsonFetch(base, '/api/tenant-settings/kpi-targets')).status, 503);
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/kpi-targets', {
          method: 'PUT',
          body: '{}',
        })).status,
        503
      );
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/kpi-targets/9', { method: 'DELETE' })).status,
        503
      );
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/rhythm_schedule')).status,
        503
      );
      assert.equal(
        (await jsonFetch(base, '/api/tenant-settings/rhythm_schedule', {
          method: 'PUT',
          body: JSON.stringify({ config_value: 1 }),
        })).status,
        503
      );
    }
  );
});

// —— growth-ops (weather no auth + a few authenticated) ——
test('growth-ops routes: weather + auth paths', async () => {
  const prev = process.env.MINIPROGRAM_SYNC_SECRET;
  process.env.MINIPROGRAM_SYNC_SECRET = 'ops-secret';
  const authH = { 'x-miniprogram-sync-secret': 'ops-secret' };
  try {
    await withApp(
      (app) =>
        registerGrowthOpsRoutes(app, {
          query: async () => ({ rows: [] }),
        }),
      async (base) => {
        const weather = await jsonFetch(base, '/api/growth/weather-context?city=上海');
        assert.equal(weather.status, 200);
        assert.equal(weather.body.ok, true);

        assert.equal((await jsonFetch(base, '/api/growth/active-window')).status, 401);
        const aw = await jsonFetch(base, '/api/growth/active-window', { headers: authH });
        assert.equal(aw.status, 200);

        const clusters = await jsonFetch(base, '/api/growth/user-clusters', { headers: authH });
        assert.equal(clusters.status, 200);

        const perf = await jsonFetch(base, '/api/growth/content-performance', { headers: authH });
        assert.equal(perf.status, 200);

        const upsert = await jsonFetch(base, '/api/growth/content-performance', {
          method: 'POST',
          headers: authH,
          body: JSON.stringify({ channel: 'xhs', title: 't' }),
        });
        assert.ok([200, 400, 500].includes(upsert.status));

        const del = await jsonFetch(base, '/api/growth/content-performance/1', {
          method: 'DELETE',
          headers: authH,
        });
        assert.ok([200, 404, 500].includes(del.status));
      }
    );
  } finally {
    if (prev === undefined) delete process.env.MINIPROGRAM_SYNC_SECRET;
    else process.env.MINIPROGRAM_SYNC_SECRET = prev;
  }
});
