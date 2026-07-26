import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTryHandleBiByFunctionCalling,
  _resetBiLastToolCtxForTests,
} from '../domains/agent-bi/try-handle-bi-by-function-calling.js';

function makeHandler(overrides = {}) {
  const calls = { llm: [], tools: [], narrate: [], sql: [] };
  const deps = {
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql).slice(0, 100), params });
        if (/LIKE '%马己仙%'/.test(sql)) {
          return { rows: [{ store: '马己仙南京西路店' }] };
        }
        if (/LIKE '%洪潮%'/.test(sql)) {
          return { rows: [{ store: '洪潮久光店' }] };
        }
        if (/GROUP BY dish_name/.test(sql)) {
          return {
            rows: [{ dish_name: '招牌菜', total_qty: 10, total_revenue: 1000, sale_days: 5 }],
          };
        }
        if (/AVG\(daily_rev\)/.test(sql)) {
          return { rows: [{ avg_rev: 5000, max_rev: 8000, min_rev: 3000 }] };
        }
        if (/dish_name LIKE/.test(sql)) {
          return { rows: [{ total_qty: 3, total_revenue: 300 }] };
        }
        return { rows: [] };
      },
    }),
    getModelTier: () => 'standard',
    getAvailableTools: () => [
      'query_sales_ranking',
      'query_complaint_product_ranking',
      'query_revenue_summary',
      'query_revenue_forecast_next_day',
      'query_table_visit',
    ],
    isToolAllowed: () => true,
    isTierBudgetExceeded: () => false,
    parseFeishuMarketingCopyTemplate: () => null,
    clampInt: (v, min, max, fallback) => {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n)) return fallback;
      return Math.max(min, Math.min(max, n));
    },
    runBiFunctionTool: async (name, store, args) => {
      calls.tools.push({ name, store, args });
      return {
        ok: true,
        source: 'pos_sales_detail',
        text: `工具结果：${name} @ ${store} limit=${args?.limit || ''}`,
      };
    },
    narrateBiToolResult: async (_t, toolText) => {
      calls.narrate.push(toolText);
      return `叙述：${toolText}`;
    },
    pushBiConversationTurn: () => {},
    getBiConversationHistory: () => [],
    buildBiIntentPlan: async () => ({
      intent: 'query_sales_ranking',
      confidence: 0.9,
      params: { limit: 10, sort_order: 'desc' },
    }),
    callLLM: async (_msgs, opts) => {
      calls.llm.push(opts);
      return {
        ok: true,
        content: '方案正文',
        message: {
          tool_calls: [
            {
              function: {
                name: 'query_sales_ranking',
                arguments: JSON.stringify({ limit: 5, sort_order: 'desc' }),
              },
            },
          ],
        },
        actualModel: 'm1',
        responseTime: 10,
        raw: { usage: { prompt_tokens: 1, completion_tokens: 2 } },
      };
    },
    getBiReasoningModel: () => 'bi-model',
    BI_FUNCTION_TOOLS: [{ type: 'function', function: { name: 'query_sales_ranking' } }],
    parseToolArgs: (raw) => {
      try {
        return JSON.parse(String(raw || '{}'));
      } catch {
        return {};
      }
    },
    buildBiFactSourceAudit: async () => [{ source: 'pos', ok: true }],
    buildBiSourceAuditText: (rows) => (rows?.length ? '源检查OK' : ''),
    ...overrides,
  };
  return { handle: createTryHandleBiByFunctionCalling(deps), calls, deps };
}

const base = {
  text: '近7天销量TOP',
  store: '洪潮久光店',
  brand: '洪潮',
  senderRole: 'store_manager',
  senderUsername: 'u1',
};

test.beforeEach(() => {
  _resetBiLastToolCtxForTests();
});

test('no valid store → null', async () => {
  const { handle } = makeHandler();
  const r = await handle({ ...base, store: '总部', text: '你好' });
  assert.equal(r, null);
});

test('marketing copy structured message → null', async () => {
  const { handle } = makeHandler({
    parseFeishuMarketingCopyTemplate: () => ({ title: '营销文案' }),
  });
  const r = await handle(base);
  assert.equal(r, null);
});

test('extract store from 马己仙 text', async () => {
  const { handle, calls } = makeHandler();
  const r = await handle({ ...base, store: '总部', text: '马己仙近7天销量' });
  assert.ok(r);
  assert.equal(r.meta.store, '马己仙南京西路店');
  assert.ok(calls.sql.some((q) => /马己仙/.test(q.sql)));
});

test('extract store from 洪潮 text', async () => {
  const { handle } = makeHandler();
  const r = await handle({ ...base, store: '', text: '洪潮营收多少' });
  assert.equal(r.meta.store, '洪潮久光店');
});

test('happy path executes tool and narrates', async () => {
  const { handle, calls } = makeHandler();
  const r = await handle(base);
  assert.match(r.response, /叙述：/);
  assert.equal(r.meta.tool, 'query_sales_ranking');
  assert.ok(calls.tools.length >= 1);
  assert.ok(calls.narrate.length >= 1);
});

test('intent not actionable → null', async () => {
  const { handle } = makeHandler({
    buildBiIntentPlan: async () => ({ intent: 'other', confidence: 0.2, params: {} }),
  });
  assert.equal(await handle(base), null);
});

test('unknown intent without tool map → null', async () => {
  const { handle } = makeHandler({
    buildBiIntentPlan: async () => ({
      intent: 'query_unknown_thing',
      confidence: 0.9,
      params: {},
    }),
  });
  assert.equal(await handle(base), null);
});

test('permission denied on preferred tool', async () => {
  const { handle } = makeHandler({
    isToolAllowed: () => false,
  });
  const r = await handle(base);
  assert.equal(r.meta.permissionDenied, true);
  assert.match(r.response, /暂无权限/);
});

test('empty tool result → null', async () => {
  const { handle } = makeHandler({
    runBiFunctionTool: async () => ({ ok: false, text: '' }),
  });
  assert.equal(await handle(base), null);
});

test('no-data tool result appends source audit', async () => {
  const { handle } = makeHandler({
    runBiFunctionTool: async () => ({
      ok: false,
      source: 'pos',
      text: '暂无销售数据',
    }),
  });
  const r = await handle(base);
  assert.equal(r.meta.noData, true);
  assert.match(r.response, /数据源检查/);
});

test('budget exceeded skips tool planner LLM', async () => {
  const { handle, calls } = makeHandler({
    isTierBudgetExceeded: () => true,
  });
  const r = await handle(base);
  assert.equal(r.meta.budgetExceeded, true);
  // marketing path not hit; tool planner skipped → only narrate LLM maybe none via callLLM for planner
  assert.ok(!calls.llm.some((o) => o?.tools));
});

test('marketing_plan_request generates plan', async () => {
  const { handle } = makeHandler({
    buildBiIntentPlan: async () => ({
      intent: 'marketing_plan_request',
      confidence: 1,
      params: { product_name: '招牌菜' },
    }),
  });
  const r = await handle({ ...base, text: '如何提升营收的行动计划' });
  assert.equal(r.meta.source, 'marketing_plan_generated');
  assert.equal(r.response, '方案正文');
});

test('marketing_plan regex override on planning words', async () => {
  const { handle } = makeHandler({
    buildBiIntentPlan: async () => ({
      intent: 'query_sales_ranking',
      confidence: 0.9,
      params: {},
    }),
  });
  const r = await handle({ ...base, text: '给我一份营销方案' });
  assert.equal(r.meta.source, 'marketing_plan_generated');
});

test('marketing_plan_request error path', async () => {
  const { handle } = makeHandler({
    buildBiIntentPlan: async () => ({
      intent: 'marketing_plan_request',
      confidence: 1,
      params: {},
    }),
    pool: () => ({
      query: async () => {
        throw new Error('db down');
      },
    }),
  });
  const r = await handle({ ...base, text: '行动计划' });
  assert.equal(r.meta.source, 'marketing_plan_error');
  assert.match(r.response, /数据查询出现问题/);
});

test('follow-up reuses last tool context', async () => {
  const { handle, calls } = makeHandler();
  // seed last ctx via first call
  await handle(base);
  const r2 = await handle({ ...base, text: '其他呢，再给我最差的' });
  assert.equal(r2.meta.followup, true);
  assert.equal(r2.meta.args.sort_order, 'asc');
  assert.ok(r2.meta.args.limit >= 10);
  assert.ok(calls.tools.length >= 2);
});

test('follow-up permission denied', async () => {
  const { handle } = makeHandler({
    isToolAllowed: (_role, tool) => tool !== 'query_sales_ranking',
    getAvailableTools: () => ['query_revenue_summary'],
  });
  // first call will also be denied on preferred tool
  const r1 = await handle(base);
  assert.equal(r1.meta.permissionDenied, true);

  // manually exercise followup denied: seed ctx by temporarily allowing then deny
  _resetBiLastToolCtxForTests();
  const { handle: h2 } = makeHandler();
  await h2(base);
  const { handle: h3 } = makeHandler({
    isToolAllowed: () => false,
    getAvailableTools: () => [],
  });
  // last ctx is module-level — seeded by h2
  const r = await h3({ ...base, text: '继续' });
  assert.equal(r.meta.permissionDenied, true);
  assert.equal(r.meta.followup, undefined);
});

test('inherit lastCtx store when HQ', async () => {
  const { handle } = makeHandler();
  await handle(base);
  const r = await handle({
    ...base,
    store: '总部',
    text: '近7天销量TOP', // not followup keywords; still inherits store for intent path
  });
  assert.equal(r.meta.store, '洪潮久光店');
});

test('sort_order heuristic asc for 最差', async () => {
  const { handle, calls } = makeHandler({
    isTierBudgetExceeded: () => true, // skip tool planner overwrite
    buildBiIntentPlan: async () => ({
      intent: 'query_sales_ranking',
      confidence: 0.9,
      params: { sort_order: 'desc', limit: 10 },
    }),
  });
  await handle({ ...base, text: '最差的菜品排名' });
  const args = calls.tools[0].args;
  assert.equal(args.sort_order, 'asc');
});

test('follow-up best keywords set sort_order desc', async () => {
  const { handle, calls } = makeHandler();
  await handle(base);
  await handle({ ...base, text: '最好的前10' });
  const last = calls.tools[calls.tools.length - 1];
  assert.equal(last.args.sort_order, 'desc');
});

test('marketing plan without product name still works', async () => {
  const { handle } = makeHandler({
    buildBiIntentPlan: async () => ({
      intent: 'marketing_plan_request',
      confidence: 1,
      params: {},
    }),
  });
  const r = await handle({ ...base, text: '给我改善方案' });
  assert.equal(r.meta.source, 'marketing_plan_generated');
});

test('product with zero sales gets新品文案 path', async () => {
  const { handle } = makeHandler({
    buildBiIntentPlan: async () => ({
      intent: 'marketing_plan_request',
      confidence: 1,
      params: { product_name: '新品X' },
    }),
    pool: () => ({
      query: async (sql) => {
        if (/dish_name LIKE/.test(sql)) {
          return { rows: [{ total_qty: 0, total_revenue: 0 }] };
        }
        if (/GROUP BY dish_name/.test(sql)) {
          return { rows: [] };
        }
        if (/AVG\(daily_rev\)/.test(sql)) {
          return { rows: [{ avg_rev: 1, max_rev: 2, min_rev: 0 }] };
        }
        return { rows: [] };
      },
    }),
  });
  const r = await handle({ ...base, text: '新品方案' });
  assert.equal(r.meta.source, 'marketing_plan_generated');
});
