import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeOpenAiCompatibleBaseUrl,
  registerAiChatCompletionsRoutes,
} from '../routes-chat-completions.js';
import { getMetricsSnapshot, resetMetrics } from '../../shared/metrics.js';

test('normalizeOpenAiCompatibleBaseUrl：Ark / v1 / 空', () => {
  assert.equal(normalizeOpenAiCompatibleBaseUrl(''), '');
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    normalizeOpenAiCompatibleBaseUrl('https://ark.cn-beijing.volces.com/v1'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiCompatibleBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
});

function mockApp() {
  const routes = [];
  return {
    routes,
    post(path, ...handlers) {
      routes.push({ path, handlers });
    },
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

test('chat-completions：缺参 400；成功/失败记 LLM metrics', async () => {
  resetMetrics();
  const app = mockApp();
  registerAiChatCompletionsRoutes(app, (_r, _s, next) => next());
  const handler = app.routes[0].handlers.at(-1);

  const resMissing = mockRes();
  await handler({ user: { username: 'u1' }, body: {} }, resMissing);
  assert.equal(resMissing.statusCode, 400);

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ choices: [{ message: { content: 'hi' } }] });
    },
  });
  try {
    const resOk = mockRes();
    await handler(
      {
        user: { username: 'u1' },
        requestId: 'rid-llm',
        body: {
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'k',
          model: 'm',
          messages: [{ role: 'user', content: 'hi' }],
        },
      },
      resOk
    );
    assert.equal(resOk.statusCode, 200);
    assert.ok(resOk.body.choices);

    globalThis.fetch = async () => {
      throw new Error('net');
    };
    const resFail = mockRes();
    await handler(
      {
        user: { username: 'u1' },
        body: {
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'k',
          model: 'm',
          messages: [{ role: 'user', content: 'x' }],
        },
      },
      resFail
    );
    assert.equal(resFail.statusCode, 502);
  } finally {
    globalThis.fetch = origFetch;
  }

  const snap = getMetricsSnapshot();
  assert.ok(Object.keys(snap.counters).some((k) => k.startsWith('llm.call.success')));
  assert.ok(Object.keys(snap.counters).some((k) => k.startsWith('llm.call.failure')));
  assert.ok(Object.keys(snap.histograms).some((k) => k.startsWith('llm.call.duration_ms')));
});
