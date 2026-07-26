import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_TTL,
  createLoaderCacheState,
  loadAgentRules,
  loadBiAgentConfig,
  loadCategoryAssigneeRoleMap,
  loadEmployeeRatingConfig,
  loadIssueScoreRulesMap,
  loadOpsAgentConfig,
} from '../config-loaders.js';
import { createAgentConfigLoaders } from '../loaders-service.js';
import {
  DEFAULT_EMPLOYEE_RATING_CONFIG,
  DEFAULT_OPS_AGENT_CONFIG,
} from '../defaults.js';

function mockPool(handlers) {
  let callIndex = 0;
  return () => ({
    query: async (sql) => {
      const handler = handlers[callIndex];
      callIndex += 1;
      if (handler instanceof Error) throw handler;
      if (typeof handler === 'function') return handler(sql, callIndex);
      return handler;
    },
  });
}

function mockLog() {
  const errors = [];
  return {
    log: { error: (...args) => errors.push(args) },
    errors,
  };
}

function makeDeps(handlers) {
  const { log, errors } = mockLog();
  return {
    deps: { pool: mockPool(handlers), log },
    errors,
  };
}

test('getAgentRules: cache miss loads rows', async () => {
  const rules = [{ category: '充值异常', assignee_role: 'store_manager', enabled: true }];
  const { deps } = makeDeps([{ rows: rules }]);
  const cache = createLoaderCacheState();

  const first = await loadAgentRules(deps, cache);
  assert.deepEqual(first, rules);
  assert.equal(cache.rulesLastFetched > 0, true);
});

test('getAgentRules: cache hit skips DB', async () => {
  const rules = [{ category: '充值异常', assignee_role: 'store_manager' }];
  const { deps } = makeDeps([
    { rows: rules },
    () => assert.fail('should not query on cache hit'),
  ]);
  const cache = createLoaderCacheState();

  await loadAgentRules(deps, cache);
  const second = await loadAgentRules(deps, cache);
  assert.deepEqual(second, rules);
});

test('getAgentRules: DB error returns []', async () => {
  const { deps, errors } = makeDeps([new Error('db down')]);
  const cache = createLoaderCacheState();

  const out = await loadAgentRules(deps, cache);
  assert.deepEqual(out, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0].msg, 'getagentrules_error');
});

test('getCategoryAssigneeRoleMap / getIssueScoreRulesMap derive from rules', async () => {
  const { deps } = makeDeps([{
    rows: [
      { category: '充值异常', assignee_role: 'store_manager', normal_deduction: 2, major_deduction: 5 },
      { category: '产品差评异常', assignee_role: 'store_production_manager', normal_deduction: 10, major_deduction: 15 },
    ],
  }]);
  const cache = createLoaderCacheState();

  const roleMap = await loadCategoryAssigneeRoleMap(deps, cache);
  assert.deepEqual(roleMap, {
    充值异常: 'store_manager',
    产品差评异常: 'store_production_manager',
  });

  const scoreMap = await loadIssueScoreRulesMap(deps, cache);
  assert.deepEqual(scoreMap, {
    充值异常: { normal: 2, major: 5 },
    产品差评异常: { normal: 10, major: 15 },
  });
});

test('getOpsAgentConfig: normalizes DB row and caches', async () => {
  const raw = {
    scheduledTasks: {
      dataTriggers: { productComplaintThreshold: 9 },
    },
  };
  const { deps } = makeDeps([
    { rows: [{ config: raw }] },
    () => assert.fail('cache hit expected'),
  ]);
  const cache = createLoaderCacheState();

  const first = await loadOpsAgentConfig(deps, cache);
  assert.equal(first.scheduledTasks.dataTriggers.productComplaintThreshold, 9);
  assert.equal(first.llmModels.reasoningModel, DEFAULT_OPS_AGENT_CONFIG.llmModels.reasoningModel);

  const second = await loadOpsAgentConfig(deps, cache);
  assert.equal(second.scheduledTasks.dataTriggers.productComplaintThreshold, 9);
});

test('getOpsAgentConfig: empty row falls back to default', async () => {
  const { deps } = makeDeps([{ rows: [] }]);
  const cache = createLoaderCacheState();

  const out = await loadOpsAgentConfig(deps, cache);
  assert.equal(out.scheduledTasks.dataTriggers.productComplaintThreshold, 2);
});

test('getOpsAgentConfig: DB error falls back to default', async () => {
  const { deps, errors } = makeDeps([new Error('timeout')]);
  const cache = createLoaderCacheState();

  const out = await loadOpsAgentConfig(deps, cache);
  assert.equal(out.llmModels.reasoningModel, DEFAULT_OPS_AGENT_CONFIG.llmModels.reasoningModel);
  assert.equal(errors[0][0].msg, 'agentconfig_getopsagentconfig_error');
});

test('getBiAgentConfig: normalizes JSON string config', async () => {
  const payload = JSON.stringify({
    anomalyTriggers: { global: { revenueGapMedium: 0.15 } },
  });
  const { deps } = makeDeps([{ rows: [{ config: payload }] }]);
  const cache = createLoaderCacheState();

  const out = await loadBiAgentConfig(deps, cache);
  assert.equal(out.anomalyTriggers.global.revenueGapMedium, 0.15);
});

test('getBiAgentConfig: DB error falls back to default', async () => {
  const { deps, errors } = makeDeps([new Error('fail')]);
  const cache = createLoaderCacheState();

  const out = await loadBiAgentConfig(deps, cache);
  assert.ok(Array.isArray(out.dataSources));
  assert.equal(errors[0][0].msg, 'agentconfig_getbiagentconfig_error');
});

test('getEmployeeRatingConfig: empty row returns default', async () => {
  const { deps } = makeDeps([{ rows: [] }]);
  const cache = createLoaderCacheState();

  const out = await loadEmployeeRatingConfig(deps, cache);
  assert.deepEqual(out.levelLabels, DEFAULT_EMPLOYEE_RATING_CONFIG.levelLabels);
});

test('clear*Cache via factory forces refetch', async () => {
  const rulesA = [{ category: 'A', assignee_role: 'store_manager' }];
  const rulesB = [{ category: 'B', assignee_role: 'store_production_manager' }];
  const { deps } = makeDeps([
    { rows: rulesA },
    { rows: rulesB },
  ]);
  const loaders = createAgentConfigLoaders(deps);

  const first = await loaders.getAgentRules();
  assert.deepEqual(first, rulesA);

  loaders.clearAgentRuleCache();

  const second = await loaders.getAgentRules();
  assert.deepEqual(second, rulesB);
});

test('factory clearOps/Bi/Employee caches force refetch', async () => {
  const { deps } = makeDeps([
    { rows: [{ config: { scheduledTasks: { dataTriggers: { productComplaintThreshold: 3 } } } }] },
    { rows: [{ config: { scheduledTasks: { dataTriggers: { productComplaintThreshold: 7 } } } }] },
    { rows: [{ config: { anomalyTriggers: { global: { revenueGapMedium: 0.12 } } } }] },
    { rows: [{ config: { anomalyTriggers: { global: { revenueGapMedium: 0.99 } } } }] },
    { rows: [{ config: { levelLabels: { A: '甲' } } }] },
    { rows: [] },
  ]);
  const loaders = createAgentConfigLoaders(deps);

  const ops1 = await loaders.getOpsAgentConfig();
  assert.equal(ops1.scheduledTasks.dataTriggers.productComplaintThreshold, 3);
  loaders.clearOpsAgentConfigCache();
  const ops2 = await loaders.getOpsAgentConfig();
  assert.equal(ops2.scheduledTasks.dataTriggers.productComplaintThreshold, 7);

  const bi1 = await loaders.getBiAgentConfig();
  assert.equal(bi1.anomalyTriggers.global.revenueGapMedium, 0.12);
  loaders.clearBiAgentConfigCache();
  const bi2 = await loaders.getBiAgentConfig();
  assert.equal(bi2.anomalyTriggers.global.revenueGapMedium, 0.99);

  const er1 = await loaders.getEmployeeRatingConfig();
  assert.equal(er1.levelLabels.A, '甲');
  loaders.clearEmployeeRatingConfigCache();
  const er2 = await loaders.getEmployeeRatingConfig();
  assert.deepEqual(er2.levelLabels, DEFAULT_EMPLOYEE_RATING_CONFIG.levelLabels);
});

test('CACHE_TTL is 60 seconds', () => {
  assert.equal(CACHE_TTL, 60 * 1000);
});
