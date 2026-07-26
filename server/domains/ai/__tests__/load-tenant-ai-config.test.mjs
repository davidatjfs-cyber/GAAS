import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoadTenantAiConfig } from '../load-tenant-ai-config.js';
import { loadTenantAiConfigBody } from '../load-tenant-ai-config-helpers.js';

test('loadTenantAiConfig: default tenant / missing llm → null', async () => {
  const load = createLoadTenantAiConfig({
    resolveTenantIdDefault: () => 'default',
    agentPool: { query: async () => ({ rows: [] }) },
  });
  assert.equal(await load('vision_scoring'), null);

  const load2 = createLoadTenantAiConfig({
    resolveTenantIdDefault: () => 't1',
    agentPool: {
      query: async () => ({ rows: [{ data: { settings: {} } }] }),
    },
  });
  assert.equal(await load2(), null);
});

test('loadTenantAiConfig: legacy + bindings path', async () => {
  const body = await loadTenantAiConfigBody(
    {
      resolveTenantIdDefault: () => 'tenant-a',
      agentPool: {
        query: async () => ({
          rows: [
            {
              data: {
                settings: {
                  llm: {
                    apiKey: 'k1',
                    baseUrl: 'https://api.openai.com',
                    model: 'gpt-4o',
                  },
                },
              },
            },
          ],
        }),
      },
      log: { warn() {} },
    },
    'default'
  );
  assert.equal(body.apiKey, 'k1');
  assert.equal(body.model, 'gpt-4o');
  assert.equal(body.baseUrl, 'https://api.openai.com/v1');
});

test('loadTenantAiConfig: models/bindings + failure fallback', async () => {
  const load = createLoadTenantAiConfig({
    resolveTenantIdDefault: () => 'tenant-a',
    agentPool: {
      query: async () => ({
        rows: [
          {
            data: {
              settings: {
                llm: {
                  models: [
                    {
                      id: 'm1',
                      apiKey: 'ak',
                      baseUrl: 'https://ark.cn-beijing.volces.com',
                      model: 'ep-1',
                      enabled: true,
                    },
                  ],
                  bindings: { vision_scoring: 'm1' },
                },
              },
            },
          },
        ],
      }),
    },
  });
  const cfg = await load('vision_scoring');
  assert.equal(cfg.model, 'ep-1');
  assert.match(cfg.baseUrl, /\/api\/v3$/);

  const loadFail = createLoadTenantAiConfig({
    resolveTenantIdDefault: () => 'tenant-a',
    agentPool: {
      query: async () => {
        throw new Error('db down');
      },
    },
  });
  assert.equal(await loadFail(), null);
});
