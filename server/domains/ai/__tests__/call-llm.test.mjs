import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallLLM } from '../call-llm.js';
import { buildCallLlmPlan, callLLMBody } from '../call-llm-helpers.js';
import { _resetProviderHealthForTests, markProviderFail } from '../llm-provider-helpers.js';

function baseDeps(overrides = {}) {
  const performanceMetrics = { totalCalls: 0, cacheHits: 0, avgResponseTime: 0, errorCount: 0 };
  const calls = { track: [], posts: [] };
  return {
    deps: {
      isExternalEnabled: () => true,
      isAiQualityExternalEnabled: () => false,
      getModelTier: () => '',
      getModelForRole: () => '',
      getTemperatureForRole: () => 0.1,
      getMaxTokensForRole: () => 1500,
      isTierBudgetExceeded: () => false,
      tenantContext: { getStore: () => '' },
      resolveTenantLlmConfig: async () => null,
      getCachedResponse: () => null,
      setCachedResponse: () => {},
      performanceMetrics,
      maskLLMMessages: (m) => m,
      axios: {
        post: async (url, body) => {
          calls.posts.push({ url, body });
          return {
            data: {
              choices: [{ message: { content: 'hello' } }],
              usage: { total_tokens: 3 },
            },
          };
        },
      },
      sanitizeLLMOutputWithAudit: async (_p, c) => c,
      sanitizeLLMOutput: (c) => c,
      pool: () => ({}),
      trackLLMCall: () => {},
      trackLLMResult: (ok) => calls.track.push(ok),
      log: { info() {}, warn() {}, error() {} },
      ...overrides,
    },
    calls,
    performanceMetrics,
  };
}

test('buildCallLlmPlan early external_disabled', () => {
  const plan = buildCallLlmPlan(
    {
      isExternalEnabled: () => false,
      isAiQualityExternalEnabled: () => false,
    },
    [{ role: 'user', content: 'hi' }],
    {}
  );
  assert.equal(plan.early.error, 'external_disabled');
});

test('createCallLLM success + cache hit + no api key', async () => {
  _resetProviderHealthForTests();
  const prev = {
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  };
  process.env.QWEN_API_KEY = 'qk';
  process.env.DEEPSEEK_API_KEY = 'dk';
  try {
    const { deps, calls } = baseDeps();
    const callLLM = createCallLLM(deps);
    const ok = await callLLM([{ role: 'user', content: 'hi' }], { model: 'qwen-max' });
    assert.equal(ok.ok, true);
    assert.equal(ok.content, 'hello');
    assert.equal(calls.track.at(-1), true);
    assert.ok(calls.posts.length >= 1);

    const { deps: deps2 } = baseDeps({
      getCachedResponse: () => 'cached',
    });
    const cached = await createCallLLM(deps2)([{ role: 'user', content: 'hi' }], {
      model: 'qwen-max',
    });
    assert.equal(cached.cached, true);
    assert.equal(cached.content, 'cached');

    process.env.QWEN_API_KEY = '';
    process.env.DEEPSEEK_API_KEY = '';
    const { deps: deps3 } = baseDeps();
    const noKey = await createCallLLM(deps3)([{ role: 'user', content: 'hi' }], {
      model: 'qwen-max',
    });
    assert.equal(noKey.ok, false);
    assert.equal(noKey.error, 'no_api_key');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetProviderHealthForTests();
  }
});

test('callLLMBody skips unhealthy provider then falls back', async () => {
  _resetProviderHealthForTests();
  const prevQ = process.env.QWEN_API_KEY;
  const prevD = process.env.DEEPSEEK_API_KEY;
  process.env.QWEN_API_KEY = 'qk';
  process.env.DEEPSEEK_API_KEY = 'dk';
  try {
    markProviderFail('qwen');
    markProviderFail('qwen');
    let sawDeepseek = false;
    const { deps, calls } = baseDeps({
      axios: {
        post: async (url) => {
          if (url.includes('deepseek')) sawDeepseek = true;
          return { data: { choices: [{ message: { content: 'fb' } }] } };
        },
      },
    });
    const r = await callLLMBody(deps, [{ role: 'user', content: 'x' }], { model: 'qwen-max' });
    assert.equal(r.ok, true);
    assert.equal(r.content, 'fb');
    assert.equal(sawDeepseek, true);
    assert.equal(calls.track.at(-1), true);
  } finally {
    if (prevQ === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = prevQ;
    if (prevD === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevD;
    _resetProviderHealthForTests();
  }
});

test('callLLMBody all providers fail + platformQuality path', async () => {
  _resetProviderHealthForTests();
  const prev = {
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    AI_QUALITY_LLM_API_KEY: process.env.AI_QUALITY_LLM_API_KEY,
    AI_QUALITY_LLM_PROVIDER: process.env.AI_QUALITY_LLM_PROVIDER,
    AI_QUALITY_LLM_MODEL: process.env.AI_QUALITY_LLM_MODEL,
    AI_QUALITY_LLM_BASE_URL: process.env.AI_QUALITY_LLM_BASE_URL,
  };
  process.env.QWEN_API_KEY = 'qk';
  process.env.DEEPSEEK_API_KEY = 'dk';
  process.env.AI_QUALITY_LLM_API_KEY = 'aq';
  process.env.AI_QUALITY_LLM_PROVIDER = 'deepseek';
  process.env.AI_QUALITY_LLM_MODEL = 'deepseek-chat';
  process.env.AI_QUALITY_LLM_BASE_URL = 'https://api.deepseek.com';
  try {
    const { deps } = baseDeps({
      axios: {
        post: async () => {
          throw Object.assign(new Error('fail'), { response: { status: 500 } });
        },
      },
    });
    const fail = await callLLMBody(deps, [{ role: 'user', content: 'x' }], { model: 'qwen-max' });
    assert.equal(fail.ok, false);
    assert.equal(fail.error, 'all_providers_failed');

    const { deps: deps2, calls } = baseDeps();
    const pq = await callLLMBody(deps2, [{ role: 'user', content: 'x' }], {
      platformQuality: true,
    });
    assert.equal(pq.ok, true);
    assert.equal(calls.track.at(-1), true);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetProviderHealthForTests();
  }
});

test('callLLMBody tools path + sanitize fallback + trackTier', async () => {
  _resetProviderHealthForTests();
  const prev = process.env.QWEN_API_KEY;
  process.env.QWEN_API_KEY = 'qk';
  try {
    let cached = null;
    const { deps } = baseDeps({
      getModelTier: () => 'standard',
      isTierBudgetExceeded: () => true,
      getTemperatureForRole: () => 0.9,
      getMaxTokensForRole: () => 2000,
      sanitizeLLMOutputWithAudit: async () => {
        throw new Error('audit fail');
      },
      sanitizeLLMOutput: (c) => `safe:${c}`,
      setCachedResponse: (k, v) => {
        cached = { k, v };
      },
      trackLLMCall: () => {},
      axios: {
        post: async () => ({
          data: {
            choices: [{ message: { content: 'raw' } }],
            usage: { total_tokens: 9 },
          },
        }),
      },
    });
    const r = await callLLMBody(deps, [{ role: 'user', content: 'x' }], {
      role: 'bi',
      model: 'qwen-max',
      tools: [{ type: 'function', function: { name: 't' } }],
      trackTier: true,
    });
    assert.equal(r.ok, true);
    assert.equal(r.content, 'safe:raw');
    assert.ok(cached?.v);
  } finally {
    if (prev === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = prev;
    _resetProviderHealthForTests();
  }
});
