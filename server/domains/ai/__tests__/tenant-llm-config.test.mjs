import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantLlmConfigCache } from '../tenant-llm-config.js';

test('tenant llm config cache resolve / invalidate / ttl', async () => {
  const prev = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = 'enc';
  let now = 1_000;
  let calls = 0;
  const cache = createTenantLlmConfigCache({
    pool: () => ({}),
    getTenantAiModelConfig: async () => {
      calls += 1;
      return { models: [{ model: 'm', provider: 'qwen', api_key: 'k' }] };
    },
    nowFn: () => now,
  });

  assert.equal(await cache.resolveTenantLlmConfig(''), null);
  const a = await cache.resolveTenantLlmConfig('t1');
  assert.equal(a.models[0].model, 'm');
  assert.equal(calls, 1);
  await cache.resolveTenantLlmConfig('t1');
  assert.equal(calls, 1);
  now += 31_000;
  await cache.resolveTenantLlmConfig('t1');
  assert.equal(calls, 2);

  cache.invalidateTenantLlmConfigCache('t1');
  await cache.resolveTenantLlmConfig('t1');
  assert.equal(calls, 3);
  cache.invalidateTenantLlmConfigCache();
  cache._resetForTests();

  if (prev === undefined) delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  else process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = prev;
});

test('tenant llm config: no enc key / fetch error → null', async () => {
  const prev = process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  const cache = createTenantLlmConfigCache({
    pool: () => ({}),
    getTenantAiModelConfig: async () => ({ models: [] }),
  });
  assert.equal(await cache.resolveTenantLlmConfig('t1'), null);

  process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = 'enc';
  const cache2 = createTenantLlmConfigCache({
    pool: () => ({}),
    getTenantAiModelConfig: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(await cache2.resolveTenantLlmConfig('t1'), null);

  if (prev === undefined) delete process.env.TENANT_INTEGRATION_ENCRYPTION_KEY;
  else process.env.TENANT_INTEGRATION_ENCRYPTION_KEY = prev;
});
