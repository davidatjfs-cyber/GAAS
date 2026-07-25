/**
 * domains/inventory-forecast/ai-forecast.js 配置解析直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArkBaseUrl,
  resolveTenantAiConfigFromState,
  resolveForecastArkConfig,
  createAiForecastHelpers,
} from '../domains/inventory-forecast/ai-forecast.js';

test('normalizeArkBaseUrl：空默认 / 补 api/v3 / 其他原样', () => {
  assert.match(normalizeArkBaseUrl(''), /ark\.cn-beijing/);
  assert.equal(
    normalizeArkBaseUrl('https://ark.cn-beijing.volces.com'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(
    normalizeArkBaseUrl('https://ark.cn-beijing.volces.com/api/v3/'),
    'https://ark.cn-beijing.volces.com/api/v3'
  );
  assert.equal(normalizeArkBaseUrl('https://other.example/v1'), 'https://other.example/v1');
});

test('resolveTenantAiConfigFromState：无 models / 绑定命中 / 回退启用模型', () => {
  assert.equal(resolveTenantAiConfigFromState({}), null);
  assert.equal(resolveTenantAiConfigFromState({ settings: { llm: {} } }), null);
  const state = {
    settings: {
      llm: {
        models: [
          { id: 'm1', enabled: false, apiKey: 'k1', baseUrl: 'https://ark.cn-beijing.volces.com', model: 'ep-a' },
          { id: 'm2', enabled: true, apiKey: 'k2', baseUrl: 'https://ark.cn-beijing.volces.com', model: 'ep-b' },
        ],
        bindings: { default: 'm2', vision_scoring: 'missing' },
      },
    },
  };
  assert.equal(resolveTenantAiConfigFromState(state, 'default').apiKey, 'k2');
  assert.equal(resolveTenantAiConfigFromState(state, 'vision_scoring').model, 'ep-b');
  assert.equal(
    resolveTenantAiConfigFromState({
      settings: { llm: { models: [{ id: 'x', enabled: true, apiKey: '', baseUrl: 'u', model: 'm' }] } },
    }),
    null
  );
});

test('resolveForecastArkConfig：租户配置优先；否则 env/aiConfig 兜底', async () => {
  const prev = { ...process.env };
  try {
    delete process.env.ARK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.INVENTORY_FORECAST_API_KEY;
    const tenant = await resolveForecastArkConfig({
      settings: {
        llm: {
          models: [
            {
              id: 'm',
              enabled: true,
              apiKey: 'tenant-key',
              baseUrl: 'https://ark.cn-beijing.volces.com',
              model: 'ep-tenant',
            },
          ],
          bindings: { default: 'm' },
        },
      },
    });
    assert.equal(tenant.apiKey, 'tenant-key');

    process.env.ARK_API_KEY = 'env-key';
    process.env.ARK_ENDPOINT_ID = 'ep-from-env';
    const fallback = await resolveForecastArkConfig({ aiConfig: { model: 'ignored' } });
    assert.equal(fallback.apiKey, 'env-key');
    assert.equal(fallback.model, 'ep-from-env');
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
  }
});

test('buildForecastByAI：无 key/无历史 → null；fetch 成功解析 / HTTP 失败', async () => {
  const { buildForecastByAI } = createAiForecastHelpers({
    isExcludedForecastProduct: (p) => p === '排除品',
  });
  assert.equal(await buildForecastByAI({ historyRows: [{ a: 1 }], target: {}, state0: {} }), null);

  const prevKey = process.env.ARK_API_KEY;
  const realFetch = global.fetch;
  process.env.ARK_API_KEY = 'k';
  try {
    assert.equal(await buildForecastByAI({ historyRows: [], target: {}, state0: {} }), null);

    global.fetch = async () => ({
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                content:
                  '说明\n{"predictions":[{"product":"菜A","qty":3,"reason":"r"},{"product":"排除品","qty":9},{"product":"","qty":1}],"summary":"ok","confidence":1.2}',
              },
            },
          ],
        };
      },
      async text() {
        return '';
      },
    });
    const out = await buildForecastByAI({
      historyRows: [{ date: '2026-07-01', products: { 菜A: 2 } }],
      target: { expectedRevenue: 1000 },
      topN: 10,
      state0: {},
    });
    assert.equal(out.predictions.length, 1);
    assert.equal(out.predictions[0].product, '菜A');
    assert.equal(out.confidence, 0.99);
    assert.equal(out.summary, 'ok');

    global.fetch = async () => ({
      ok: false,
      status: 500,
      async text() {
        return 'boom';
      },
    });
    await assert.rejects(
      () => buildForecastByAI({ historyRows: [{ date: 'd' }], target: {}, state0: {} }),
      /forecast_ai_http_500/
    );
  } finally {
    global.fetch = realFetch;
    if (prevKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = prevKey;
  }
});
