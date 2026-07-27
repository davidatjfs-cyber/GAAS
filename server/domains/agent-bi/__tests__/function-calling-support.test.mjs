import test from 'node:test';
import assert from 'node:assert/strict';
import { createBiFunctionCallingSupport } from '../function-calling-support.js';

function makeSupport(overrides = {}) {
  const calls = [];
  const support = createBiFunctionCallingSupport({
    callLLM: async (messages, options) => {
      calls.push({ messages, options });
      return { content: '{"intent":"query_sales_ranking","confidence":0.8,"params":{"limit":10}}' };
    },
    getBiReasoningModel: () => 'bi-test-model',
    ...overrides,
  });
  return { support, calls };
}

test('exposes the unchanged BI function tool definitions', () => {
  const { support } = makeSupport();
  assert.deepEqual(
    support.BI_FUNCTION_TOOLS.map((tool) => tool.function.name),
    [
      'query_sales_ranking',
      'query_complaint_product_ranking',
      'query_revenue_summary',
      'query_revenue_forecast_next_day',
      'query_table_visit',
    ]
  );
});

test('parses and normalizes tool planning input safely', () => {
  const { support } = makeSupport();
  assert.deepEqual(support.parseToolArgs('{"limit":3}'), { limit: 3 });
  assert.deepEqual(support.parseToolArgs({ limit: 4 }), { limit: 4 });
  assert.deepEqual(support.parseToolArgs('bad json'), {});
  assert.deepEqual(support.parseToolArgs(null), {});
  assert.deepEqual(support.tryParseJsonObjectFromText('答案：{"limit":5}'), { limit: 5 });
  assert.equal(support.tryParseJsonObjectFromText('[]'), null);
  assert.deepEqual(
    support.normalizeIntentPlan({ intent: ' x ', confidence: 4, params: 'bad' }),
    { intent: 'x', confidence: 1, params: {} }
  );
  assert.deepEqual(support.normalizeIntentPlan(), { intent: 'other', confidence: 0, params: {} });
});

test('retains only the configured recent conversation turns', () => {
  const { support } = makeSupport();
  support._resetBiConversationCtxForTests();
  for (let i = 0; i < 5; i += 1) {
    support.pushBiConversationTurn('u1', `question-${i}`, `answer-${i}`, 'query_sales_ranking');
  }
  const history = support.getBiConversationHistory('u1');
  assert.equal(history.length, 8);
  assert.equal(history[0].q, 'question-1');
  assert.equal(history.at(-1).a, 'answer-4');
});

test('expires stale conversation history', () => {
  const { support } = makeSupport();
  support._resetBiConversationCtxForTests();
  const originalNow = Date.now;
  try {
    Date.now = () => 100;
    support.pushBiConversationTurn('u1', 'question', 'answer');
    Date.now = () => 100 + 10 * 60 * 1000 + 1;
    assert.deepEqual(support.getBiConversationHistory('u1'), []);
  } finally {
    Date.now = originalNow;
  }
});

test('builds a normalized intent plan through injected LLM', async () => {
  const { support, calls } = makeSupport();
  const plan = await support.buildBiIntentPlan(
    '给我前十',
    '洪潮店',
    [{ role: 'user', q: '菜品排行', tool: 'query_sales_ranking' }],
    'store_manager'
  );
  assert.deepEqual(plan, {
    intent: 'query_sales_ranking',
    confidence: 0.8,
    params: { limit: 10 },
  });
  assert.equal(calls[0].options.model, 'bi-test-model');
  assert.equal(calls[0].options.purpose, 'analysis');
  assert.match(calls[0].messages[0].content, /最近对话记录/);
});

test('falls back when the planner does not return an object', async () => {
  const { support } = makeSupport({
    callLLM: async () => ({ content: 'not json' }),
  });
  assert.deepEqual(
    await support.buildBiIntentPlan('查营收', '洪潮店'),
    { intent: 'other', confidence: 0, params: {} }
  );
});

test('narrates through injected LLM and falls back to tool text', async () => {
  const { support, calls } = makeSupport({
    callLLM: async (messages, options) => {
      calls.push({ messages, options });
      return { content: '  近7天营业额稳定  ' };
    },
  });
  assert.equal(
    await support.narrateBiToolResult('营收如何', '营业额：100', '洪潮店', 'store_manager'),
    '近7天营业额稳定'
  );
  assert.equal(calls[0].options.purpose, 'reasoning');

  const { support: fallbackSupport } = makeSupport({
    callLLM: async () => ({ content: '' }),
  });
  assert.equal(
    await fallbackSupport.narrateBiToolResult('营收如何', '营业额：100', '洪潮店'),
    '营业额：100'
  );
});
