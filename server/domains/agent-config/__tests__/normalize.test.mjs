import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BI_AGENT_CONFIG, DEFAULT_RULES } from '../defaults.js';
import {
  normalizeBiAgentConfig,
  normalizeBiAnomalyDictionary,
  normalizeBiAnomalyTriggers,
  normalizeEmployeeRatingConfig,
  normalizeOpsAgentConfig,
  validateEmployeeRatingConfig,
} from '../normalize.js';
import {
  normalizeFrequency,
  normalizeModelName,
  normalizeOpsStore,
  normalizeOpsType,
} from '../normalize-helpers.js';

test('normalizeOpsAgentConfig normalizes daily and random inspections', () => {
  const out = normalizeOpsAgentConfig({
    llmModels: { reasoningModel: 'bad-model', visionModel: 'ep-custom' },
    scheduledTasks: {
      dailyInspections: [{
        store: ' 洪潮店 ',
        brand: ' 洪潮 ',
        type: '',
        time: '',
        frequency: 'not-valid',
        customIntervalDays: 0,
        timeWindow: 3,
        checklist: [' 地面 ', '', ' 台面 '],
      }],
      randomInspections: [{
        store: ' 马己仙 ',
        brand: ' 马己仙 ',
        interval: [0, 1],
        assigneeRoles: [],
      }],
      dataTriggers: { productComplaintThreshold: 5 },
    },
  });

  assert.equal(out.llmModels.reasoningModel, 'qwen-max');
  assert.equal(out.llmModels.visionModel, 'ep-custom');
  assert.equal(out.scheduledTasks.dataTriggers.productComplaintThreshold, 5);
  assert.equal(out.scheduledTasks.dataTriggers.marginDeviationThreshold, 0.01);

  const daily = out.scheduledTasks.dailyInspections[0];
  assert.equal(daily.store, '洪潮店');
  assert.equal(daily.brand, '洪潮');
  assert.equal(daily.type, 'opening');
  assert.equal(daily.time, '10:00');
  assert.equal(daily.frequency, 'daily');
  assert.equal(daily.customIntervalDays, 1);
  assert.equal(daily.timeWindow, 5);
  assert.deepEqual(daily.checklist, ['地面', '台面']);

  const random = out.scheduledTasks.randomInspections[0];
  assert.equal(random.store, '马己仙');
  assert.equal(random.type, '食安抽检');
  assert.equal(random.intervalMinHours, 2);
  assert.equal(random.intervalMaxHours, 2);
  assert.deepEqual(random.assigneeRoles, ['store_manager', 'store_production_manager']);
});

test('normalizeBiAnomalyDictionary dedupes keys and falls back to DEFAULT_RULES', () => {
  const deduped = normalizeBiAnomalyDictionary([
    { key: 'dup', category: 'A', label: 'A1' },
    { key: 'dup', category: 'B', label: 'B1' },
    { key: '  ', category: 'skip' },
    { key: 'ok', label: '桌访占比异常' },
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].key, 'dup');
  assert.equal(deduped[1].category, '桌访占比异常');

  const fallback = normalizeBiAnomalyDictionary([]);
  assert.equal(fallback.length, DEFAULT_RULES.length);
  assert.equal(fallback[0].category, DEFAULT_RULES[0].category);
  assert.equal(fallback[0].enabled, true);
});

test('normalizeBiAnomalyTriggers supports legacy flat global format', () => {
  const flat = normalizeBiAnomalyTriggers({ revenueGapMedium: 0.15, badReviewHigh: 3 });
  assert.equal(flat.global.revenueGapMedium, 0.15);
  assert.equal(flat.global.badReviewHigh, 3);
  assert.equal(flat.global.efficiencyMedium, DEFAULT_BI_AGENT_CONFIG.anomalyTriggers.global.efficiencyMedium);
  assert.deepEqual(flat.storeOverrides, DEFAULT_BI_AGENT_CONFIG.anomalyTriggers.storeOverrides);

  const nested = normalizeBiAnomalyTriggers({
    global: { marginMedium: 0.7 },
    storeOverrides: { '测试店': { marginMedium: 0.65 } },
  });
  assert.equal(nested.global.marginMedium, 0.7);
  assert.deepEqual(nested.storeOverrides['测试店'], { marginMedium: 0.65 });
});

test('validateEmployeeRatingConfig rejects invalid and accepts normalized config', () => {
  assert.equal(validateEmployeeRatingConfig(null), false);
  assert.equal(validateEmployeeRatingConfig('bad'), false);
  assert.equal(validateEmployeeRatingConfig({
    execution: { store_production_manager: { A_max_missing: 'NaN' } },
  }), true);

  const valid = normalizeEmployeeRatingConfig({});
  assert.equal(validateEmployeeRatingConfig(valid), true);
  assert.equal(validateEmployeeRatingConfig({
    execution: {
      store_production_manager: { threshold_A: 5 },
      store_manager: {
        hongchao: { min_A: 280 },
        majixian: { max_missing_A: 1, max_low_A: 1 },
      },
    },
    attitude: { threshold_B: 3 },
    ability: {
      store_production_manager: { min_A: 1.2 },
      store_manager: { hongchao: { min_B: 4.4 }, majixian: { max_D: 3.8 } },
    },
  }), true);
});

test('normalizeBiAgentConfig merges dataSources by key without adding unknown keys', () => {
  const out = normalizeBiAgentConfig({
    dataSources: [
      { key: 'daily_reports', label: '自定义日报', enabled: false },
      { key: 'unknown_source', label: '不应出现', enabled: true },
    ],
    anomalyTriggers: { global: { revenueGapMedium: 0.12 } },
  });

  assert.equal(out.dataSources.length, DEFAULT_BI_AGENT_CONFIG.dataSources.length);
  const daily = out.dataSources.find((x) => x.key === 'daily_reports');
  assert.equal(daily.label, '自定义日报');
  assert.equal(daily.enabled, false);
  assert.equal(daily.sourceType, 'system');
  assert.equal(out.dataSources.some((x) => x.key === 'unknown_source'), false);
  assert.equal(out.anomalyTriggers.global.revenueGapMedium, 0.12);
});

test('normalize helper primitives trim and whitelist values', () => {
  assert.equal(normalizeModelName('deepseek-chat'), 'deepseek-chat');
  assert.equal(normalizeModelName('gpt-4'), 'qwen-max');
  assert.equal(normalizeFrequency('weekly'), 'weekly');
  assert.equal(normalizeFrequency('hourly'), 'daily');
  assert.equal(normalizeOpsType('closing'), 'closing');
  assert.equal(normalizeOpsType(''), 'opening');
  assert.equal(normalizeOpsStore('  store '), 'store');
});
