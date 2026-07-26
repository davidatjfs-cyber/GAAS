import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunChiefEvaluator } from '../domains/agent-evaluator/run-chief-evaluator.js';

function makeRunner(overrides = {}) {
  const calls = { sql: [], llm: 0, storeRating: 0, empScore: 0 };
  const run = createRunChiefEvaluator({
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql), params });
        return { rows: [] };
      },
    }),
    getSharedState: async () => ({
      stores: [{ name: '洪潮久光店', brand: '洪潮' }],
      employees: [
        {
          username: 'mgr1',
          name: '张店长',
          store: '洪潮久光店',
          role: 'store_manager',
        },
        {
          username: 'prod1',
          name: '李出品',
          store: '洪潮久光店',
          role: 'store_production_manager',
        },
        { username: 'skip', store: '洪潮久光店', role: 'waiter' },
        { username: '', store: '洪潮久光店', role: 'store_manager' },
      ],
      users: [],
    }),
    getStoresFromState: (state) => state.stores || [],
    resolveBrandContextByStore: () => ({ brandName: '洪潮', brandId: 'hc' }),
    inferBrandFromStoreName: () => '洪潮',
    getBrandRuntimeConfig: () => ({ label: '洪潮餐饮' }),
    calculateStoreRating: async () => {
      calls.storeRating++;
      return { rating: 'A' };
    },
    calculateEmployeeScore: async (_store, username) => {
      calls.empScore++;
      if (username === 'prod1') return null;
      return {
        total_score: 88,
        execution_rating: 90,
        attitude_rating: 85,
        ability_rating: 87,
      };
    },
    callLLM: async () => {
      calls.llm++;
      return { content: '表现稳定，继续保持。' };
    },
    ...overrides,
  });
  return { run, calls };
}

test('missing period', async () => {
  const { run } = makeRunner();
  assert.deepEqual(await run(''), { error: 'missing_period' });
  assert.deepEqual(await run('   '), { error: 'missing_period' });
});

test('legacy weekly period skipped', async () => {
  const { run, calls } = makeRunner();
  const r = await run('2026-W12');
  assert.equal(r.skipped, true);
  assert.equal(r.model, 'legacy_weekly_disabled');
  assert.equal(r.evaluated, 0);
  assert.equal(calls.sql.length, 0);
});

test('monthly evaluate upserts scores', async () => {
  const { run, calls } = makeRunner();
  const r = await run('2026-07', 't1');
  assert.equal(r.model, 'new_scoring_model');
  assert.equal(r.evaluated, 1);
  assert.equal(r.results[0].username, 'mgr1');
  assert.equal(r.results[0].totalScore, 88);
  assert.equal(r.results[0].summary, '表现稳定，继续保持。');
  assert.equal(r.results[0].breakdown.store_rating, 'A');
  assert.ok(calls.sql.some((q) => /INSERT INTO agent_scores/.test(q.sql)));
  assert.equal(calls.sql[0].params[11], 't1');
  assert.equal(calls.sql[0].params[6], 'new_model');
  assert.equal(calls.llm, 1);
  // prod1 score null → skipped; waiter skipped; empty username skipped
  assert.equal(calls.empScore, 2);
});

test('LLM failure still upserts with empty summary', async () => {
  const { run, calls } = makeRunner({
    callLLM: async () => {
      throw new Error('llm down');
    },
  });
  const r = await run('2026-07');
  assert.equal(r.evaluated, 1);
  assert.equal(r.results[0].summary, '');
  assert.ok(calls.sql.length >= 1);
});

test('upsert error still returns result', async () => {
  const { run } = makeRunner({
    pool: () => ({
      query: async () => {
        throw new Error('db');
      },
    }),
  });
  const r = await run('2026-07');
  assert.equal(r.evaluated, 1);
  assert.equal(r.results[0].username, 'mgr1');
});

test('brand fallback chain', async () => {
  const { run, calls } = makeRunner({
    resolveBrandContextByStore: () => ({}),
    getSharedState: async () => ({
      stores: [{ name: '未知店' }],
      employees: [
        { username: 'm1', name: 'M', store: '未知店', role: 'store_manager' },
      ],
      users: [],
    }),
    inferBrandFromStoreName: () => '',
    calculateEmployeeScore: async () => ({
      total_score: 70,
      execution_rating: 70,
      attitude_rating: 70,
      ability_rating: 70,
    }),
  });
  const r = await run('2026-07');
  assert.equal(r.results[0].brand, '洪潮');
  assert.equal(calls.sql[0].params[0], '洪潮');
});

test('production manager role label in LLM prompt', async () => {
  let prompt = '';
  const { run } = makeRunner({
    getSharedState: async () => ({
      stores: [{ name: '洪潮久光店', brand: '洪潮' }],
      employees: [
        {
          username: 'prod1',
          name: '李出品',
          store: '洪潮久光店',
          role: 'store_production_manager',
        },
      ],
      users: [],
    }),
    calculateEmployeeScore: async () => ({
      total_score: 80,
      execution_rating: 80,
      attitude_rating: 80,
      ability_rating: 80,
    }),
    callLLM: async (msgs) => {
      prompt = msgs[1].content;
      return { content: 'ok' };
    },
  });
  await run('2026-07');
  assert.match(prompt, /出品经理/);
});

test('users array also contributes managers', async () => {
  const { run } = makeRunner({
    getSharedState: async () => ({
      stores: [{ name: '洪潮久光店', brand: '洪潮' }],
      employees: [],
      users: [
        {
          username: 'u1',
          name: 'U',
          store: '洪潮久光店',
          role: 'store_manager',
        },
      ],
    }),
    calculateEmployeeScore: async () => ({
      total_score: 91,
      execution_rating: 91,
      attitude_rating: 91,
      ability_rating: 91,
    }),
  });
  const r = await run('2026-07');
  assert.equal(r.evaluated, 1);
  assert.equal(r.results[0].username, 'u1');
});

test('no stores → empty results', async () => {
  const { run } = makeRunner({
    getSharedState: async () => ({ stores: [], employees: [], users: [] }),
  });
  const r = await run('2026-07');
  assert.equal(r.evaluated, 0);
  assert.equal(r.results.length, 0);
});
