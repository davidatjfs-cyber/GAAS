import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStoreThresholdFromConfig,
  isBiSourceEnabledFromConfig,
  getBiReasoningModelFromConfig,
  getOpsVisionModelFromConfig,
  mergeBiRuntimeConfig,
  mergeOpsRuntimeConfig,
} from '../runtime-config-helpers.js';
import { INITIAL_BI_AGENT_CONFIG } from '../runtime-config-defaults.js';
import { createAgentRuntimeConfig } from '../runtime-config.js';

test('getStoreThreshold prefers store override then global', () => {
  const cfg = {
    anomalyTriggers: {
      global: { marginMedium: 0.69 },
      storeOverrides: { 洪潮店: { marginMedium: 0.64 } },
    },
  };
  assert.equal(getStoreThresholdFromConfig(cfg, '洪潮店', 'marginMedium', 0.5), 0.64);
  assert.equal(getStoreThresholdFromConfig(cfg, '马己仙店', 'marginMedium', 0.5), 0.69);
  assert.equal(getStoreThresholdFromConfig(cfg, 'x', 'missing', 0.5), 0.5);
});

test('isBiSourceEnabled defaults true when unknown', () => {
  assert.equal(isBiSourceEnabledFromConfig(INITIAL_BI_AGENT_CONFIG, 'daily_reports'), true);
  assert.equal(
    isBiSourceEnabledFromConfig({ dataSources: [{ key: 'daily_reports', enabled: false }] }, 'daily_reports'),
    false,
  );
  assert.equal(isBiSourceEnabledFromConfig({}, 'anything'), true);
});

test('model helpers fall back to deepseek / vision defaults', () => {
  assert.equal(getBiReasoningModelFromConfig({}, 'deepseek-chat'), 'deepseek-chat');
  assert.equal(
    getOpsVisionModelFromConfig({ llmModels: { visionModel: 'gpt-4o' } }, 'ep-abc'),
    'ep-abc',
  );
  assert.equal(
    getOpsVisionModelFromConfig({ llmModels: { visionModel: 'ep-custom' } }, 'ep-abc'),
    'ep-custom',
  );
});

test('merge helpers deep-merge anomalyTriggers / shallow scheduledTasks', () => {
  const bi = mergeBiRuntimeConfig(
    { a: 1, anomalyTriggers: { global: { x: 1 }, storeOverrides: { s1: { y: 1 } } } },
    { b: 2, anomalyTriggers: { global: { x: 9, z: 3 }, storeOverrides: { s2: { w: 1 } } } },
  );
  assert.equal(bi.a, 1);
  assert.equal(bi.b, 2);
  assert.deepEqual(bi.anomalyTriggers.global, { x: 9, z: 3 });
  assert.deepEqual(bi.anomalyTriggers.storeOverrides, { s1: { y: 1 }, s2: { w: 1 } });

  const ops = mergeOpsRuntimeConfig(
    { scheduledTasks: { dailyInspections: [1], dataTriggers: { a: 1 } } },
    { scheduledTasks: { randomInspections: [2] } },
  );
  assert.deepEqual(ops.scheduledTasks.dailyInspections, [1]);
  assert.deepEqual(ops.scheduledTasks.randomInspections, [2]);
});

test('factory refresh updates getters without exporting writable mirrors', async () => {
  const api = createAgentRuntimeConfig({
    getBiAgentConfig: async () => ({
      llmModels: { reasoningModel: 'bi-remote' },
      anomalyTriggers: { global: { marginMedium: 0.55 } },
    }),
    getOpsAgentConfig: async () => ({
      llmModels: { reasoningModel: 'ops-remote', visionModel: 'ep-remote' },
      scheduledTasks: { dataTriggers: { productComplaintThreshold: 9 } },
    }),
    log: { error() {} },
    deepseekModel: 'deepseek-chat',
    deepseekVisionModel: 'ep-fallback',
  });

  assert.equal(api.getBiReasoningModel(), 'deepseek-chat');
  await api.refreshBiAgentRuntimeConfig();
  assert.equal(api.getBiReasoningModel(), 'bi-remote');
  assert.equal(api.getStoreThreshold('x', 'marginMedium', 0), 0.55);

  await api.refreshOpsAgentRuntimeConfig();
  assert.equal(api.getOpsReasoningModel(), 'ops-remote');
  assert.equal(api.getOpsVisionModel(), 'ep-remote');
  assert.equal(api.getOpsAgentConfig().scheduledTasks.dataTriggers.productComplaintThreshold, 9);
  assert.equal(api.getBiAgentConfig().llmModels.reasoningModel, 'bi-remote');
  assert.equal(api.isBiSourceEnabled('daily_reports'), true);
});

test('factory refresh swallows loader errors', async () => {
  const errors = [];
  const api = createAgentRuntimeConfig({
    getBiAgentConfig: async () => {
      throw new Error('bi boom');
    },
    getOpsAgentConfig: async () => {
      throw new Error('ops boom');
    },
    log: { error: (...args) => errors.push(args.join(' ')) },
    deepseekModel: 'deepseek-chat',
    deepseekVisionModel: 'ep-fallback',
  });
  await api.refreshBiAgentRuntimeConfig();
  await api.refreshOpsAgentRuntimeConfig();
  assert.equal(api.getBiReasoningModel(), 'deepseek-chat');
  assert.equal(api.getOpsReasoningModel(), 'deepseek-chat');
  assert.equal(errors.length, 2);
});
