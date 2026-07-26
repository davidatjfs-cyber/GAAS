import test from 'node:test';
import assert from 'node:assert/strict';
import {
  _resetProviderHealthForTests,
  getLLMClientConfig,
  getProviderHealthStatus,
  getTextFallbackChain,
  isProviderHealthy,
  isRetryableLLMError,
  markProviderFail,
  markProviderOk,
  normalizeOpenAiCompatibleBaseUrlForTenant,
  resolveModelProvider,
  sleep,
} from '../llm-provider-helpers.js';

test('resolveModelProvider by name / force', () => {
  assert.equal(resolveModelProvider('qwen-max'), 'qwen');
  assert.equal(resolveModelProvider('foo-dashscope'), 'qwen');
  assert.equal(resolveModelProvider('doubao-pro'), 'doubao');
  assert.equal(resolveModelProvider('ep-123'), 'doubao');
  assert.equal(resolveModelProvider('x-volces-y'), 'doubao');
  assert.equal(resolveModelProvider('ark-model'), 'doubao');
  assert.equal(resolveModelProvider('deepseek-chat'), 'deepseek');
  assert.equal(resolveModelProvider('anything', 'qwen'), 'qwen');
});

test('normalizeOpenAiCompatibleBaseUrlForTenant', () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrlForTenant(''), '');
  assert.equal(
    normalizeOpenAiCompatibleBaseUrlForTenant('https://api.openai.com'),
    'https://api.openai.com/v1'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrlForTenant('https://api.openai.com/v1'),
    'https://api.openai.com/v1'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrlForTenant('https://ark.cn-beijing.volces.com'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrlForTenant('https://ark.cn-beijing.volces.com/v1'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrlForTenant('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
});

test('getLLMClientConfig picks provider env', () => {
  const prev = {
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    ARK_API_KEY: process.env.ARK_API_KEY,
    DOUBAO_API_KEY: process.env.DOUBAO_API_KEY,
  };
  process.env.QWEN_API_KEY = 'qk';
  process.env.DEEPSEEK_API_KEY = 'dk';
  process.env.ARK_API_KEY = 'ak';
  try {
    assert.equal(getLLMClientConfig('qwen-max').provider, 'qwen');
    assert.equal(getLLMClientConfig('qwen-max').apiKey, 'qk');
    assert.equal(getLLMClientConfig('ep-1').provider, 'doubao');
    assert.equal(getLLMClientConfig('ep-1').apiKey, 'ak');
    assert.equal(getLLMClientConfig('deepseek-chat').provider, 'deepseek');
    assert.equal(getLLMClientConfig('x', { forceProvider: 'qwen' }).provider, 'qwen');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('provider health mark / cooldown / status', () => {
  _resetProviderHealthForTests();
  markProviderFail('deepseek');
  assert.equal(isProviderHealthy('deepseek'), true);
  markProviderFail('deepseek');
  assert.equal(isProviderHealthy('deepseek'), false);
  const st = getProviderHealthStatus();
  assert.equal(st.deepseek.healthy, false);
  assert.equal(st.deepseek.failCount, 2);
  markProviderOk('deepseek');
  assert.equal(isProviderHealthy('deepseek'), true);
  assert.equal(isProviderHealthy('unknown'), true);
});

test('getTextFallbackChain includes alternate providers when keys present', () => {
  const prevQ = process.env.QWEN_API_KEY;
  const prevD = process.env.DEEPSEEK_API_KEY;
  process.env.QWEN_API_KEY = 'qk';
  process.env.DEEPSEEK_API_KEY = 'dk';
  try {
    const chain = getTextFallbackChain('deepseek-chat');
    assert.equal(chain[0].provider, 'deepseek');
    assert.ok(chain.some((c) => c.provider === 'qwen'));
  } finally {
    if (prevQ === undefined) delete process.env.QWEN_API_KEY;
    else process.env.QWEN_API_KEY = prevQ;
    if (prevD === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevD;
  }
});

test('isRetryableLLMError + sleep', async () => {
  assert.equal(isRetryableLLMError({ response: { status: 429 } }), true);
  assert.equal(isRetryableLLMError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isRetryableLLMError({ message: 'socket hang up' }), true);
  assert.equal(isRetryableLLMError({ response: { status: 400 } }), false);
  const t0 = Date.now();
  await sleep(15);
  assert.ok(Date.now() - t0 >= 10);
});
