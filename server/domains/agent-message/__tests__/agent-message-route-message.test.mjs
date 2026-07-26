import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRouteMessage,
  inferRouteByRules,
} from '../route-message.js';

/** 避开 P0–P2.5 / followup 关键词，强制走 LLM */
const LLM_TEXT = '这个事情应该找谁处理比较合适';

function makeRouter(overrides = {}) {
  const calls = { llm: 0, rule: 0, memory: 0, sql: [] };
  const route = createRouteMessage({
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql), params });
        return { rows: [] };
      },
    }),
    callLLM: async () => {
      calls.llm++;
      return { content: '{"route":"general","confidence":0.9,"reason":"ok"}' };
    },
    matchAnalysisRule: async () => {
      calls.rule++;
      return null;
    },
    logExecutorEvent: () => {},
    getFeatureFlags: () => ({
      enable_rule_engine: false,
      enable_metric_dictionary: false,
    }),
    getAgentLongMemory: async () => {
      calls.memory++;
      return null;
    },
    ...overrides,
  });
  return { route, calls };
}

test('inferRouteByRules image / keywords / empty', () => {
  assert.equal(inferRouteByRules('', false), null);
  assert.equal(inferRouteByRules('x', true).route, 'ops_supervisor');
  assert.equal(inferRouteByRules('我要申诉扣分', false).route, 'appeal');
  assert.equal(inferRouteByRules('昨天营业额', false).route, 'data_auditor');
  assert.equal(inferRouteByRules('SOP退款标准', false).route, 'train_advisor');
  assert.equal(inferRouteByRules('我的绩效分数', false).route, 'chief_evaluator');
  assert.equal(inferRouteByRules('开市检查表', false).route, 'ops_supervisor');
});

test('P0 plan request', async () => {
  const { route, calls } = makeRouter();
  const r = await route('给我做一个营销方案提升营收', false, 'u1');
  assert.equal(r.route, 'data_auditor');
  assert.equal(r.reason, 'plan_request_p0');
  assert.equal(calls.llm, 0);
});

test('rule engine hit', async () => {
  let ruleHits = 0;
  const { route, calls } = makeRouter({
    getFeatureFlags: () => ({
      enable_rule_engine: true,
      enable_metric_dictionary: true,
    }),
    matchAnalysisRule: async () => {
      ruleHits++;
      return {
        route: 'data_auditor',
        intent: 'revenue',
        intent_label: '营收',
        required_metrics: ['m1'],
      };
    },
  });
  const r = await route('随便问一句不命中P0的话', false, 'u1');
  assert.equal(r.route, 'data_auditor');
  assert.match(r.reason, /rule_engine/);
  assert.equal(ruleHits, 1);
  assert.equal(calls.llm, 0);
});

test('rule engine error falls through to keyword rules', async () => {
  const { route } = makeRouter({
    getFeatureFlags: () => ({
      enable_rule_engine: true,
      enable_metric_dictionary: true,
    }),
    matchAnalysisRule: async () => {
      throw new Error('rule down');
    },
  });
  const r = await route('差评情况怎么样', false, 'u1');
  assert.equal(r.route, 'data_auditor');
});

test('explicit data keywords → data_auditor', async () => {
  const { route, calls } = makeRouter();
  const r = await route('客单价多少', false, 'u1');
  assert.equal(r.route, 'data_auditor');
  assert.equal(calls.llm, 0);
});

test('followup digit uses long memory route', async () => {
  const { route } = makeRouter({
    getAgentLongMemory: async () => ({ route: 'train_advisor' }),
  });
  const r = await route('1', false, 'u1');
  assert.equal(r.route, 'train_advisor');
  assert.equal(r.reason, 'memory_followup');
});

test('followup without memory → general', async () => {
  const { route } = makeRouter();
  const r = await route('继续', false, 'u1');
  assert.equal(r.route, 'general');
});

test('LLM happy path', async () => {
  const calls = { llm: 0, sql: [] };
  const { route } = makeRouter({
    callLLM: async () => {
      calls.llm++;
      return {
        content: '```json\n{"route":"appeal","confidence":0.95,"reason":"投诉"}\n```',
      };
    },
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql), params });
        return {
          rows: [
            { content: '你好', direction: 'in' },
            { content: '请说', direction: 'out' },
          ],
        };
      },
    }),
  });
  const r = await route(LLM_TEXT, false, 'u1');
  assert.equal(r.route, 'appeal');
  assert.ok(calls.llm >= 1);
  assert.ok(calls.sql.some((q) => /agent_messages/.test(q.sql)));
});

test('LLM low confidence → clarify', async () => {
  const { route } = makeRouter({
    callLLM: async () => ({
      content: '{"route":"general","confidence":0.4,"reason":"您是想查数据还是培训？"}',
    }),
  });
  const r = await route(LLM_TEXT, false, 'u1');
  assert.equal(r.route, 'clarify');
  assert.match(r.message, /数据还是培训/);
});

test('LLM parse fail → general', async () => {
  const { route } = makeRouter({
    callLLM: async () => ({ content: 'not-json' }),
  });
  assert.equal((await route(LLM_TEXT, false, '')).route, 'general');
});

test('LLM throw → general', async () => {
  const { route } = makeRouter({
    callLLM: async () => {
      throw new Error('llm down');
    },
  });
  const r = await route(LLM_TEXT, false, '');
  assert.equal(r.route, 'general');
});

test('history fetch error ignored', async () => {
  const { route } = makeRouter({
    pool: () => ({
      query: async () => {
        throw new Error('db');
      },
    }),
    callLLM: async () => ({
      content: '{"route":"general","confidence":0.9,"reason":"x"}',
    }),
  });
  const r = await route(LLM_TEXT, false, 'u1');
  assert.equal(r.route, 'general');
});

test('invalid LLM route falls back to general', async () => {
  const { route } = makeRouter({
    callLLM: async () => ({
      content: '{"route":"unknown_agent","confidence":0.99,"reason":"x"}',
    }),
  });
  const r = await route(LLM_TEXT, false, '');
  assert.equal(r.route, 'general');
});

test('ops keyword blocks explicit data short-circuit', async () => {
  const { route, calls } = makeRouter({
    callLLM: async () => ({
      content: '{"route":"ops_supervisor","confidence":0.9,"reason":"巡检"}',
    }),
  });
  const r = await route('巡检时顺便看下营业额', false, '');
  assert.equal(r.route, 'ops_supervisor');
  assert.equal(calls.llm, 0);
});

test('safeJsonParse recovers object from prose wrapper', async () => {
  const { route } = makeRouter({
    callLLM: async () => ({
      content: '结果如下：\n{"route":"train_advisor","confidence":0.88,"reason":"sop"}\n完',
    }),
  });
  const r = await route(LLM_TEXT, false, '');
  assert.equal(r.route, 'train_advisor');
});

test('empty / chinese numeral followup → general without username', async () => {
  const { route } = makeRouter();
  assert.equal((await route('三', false, '')).route, 'general');
  assert.equal((await route('', false, '')).route, 'general');
});
