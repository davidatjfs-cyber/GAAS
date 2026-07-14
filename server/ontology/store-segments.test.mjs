import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBusinessType,
  classifyScale,
  classifyPriceBand,
  listBusinessTypes,
  getBusinessType,
  getKpiWeights,
} from './store-segments.js';

test('classifyBusinessType maps cuisine/keywords to the right type, defaults to mixed', () => {
  assert.equal(classifyBusinessType('潮汕牛肉火锅'), 'hotpot');
  assert.equal(classifyBusinessType('精品 Bistro'), 'western');
  assert.equal(classifyBusinessType('粤菜私房菜'), 'banquet');
  assert.equal(classifyBusinessType('川菜馆'), 'casual_dining');
  assert.equal(classifyBusinessType(''), 'mixed');
  assert.equal(classifyBusinessType('完全没见过的品类'), 'mixed');
});

test('listBusinessTypes returns all canonical types incl. mixed fallback', () => {
  const types = listBusinessTypes();
  assert.equal(types.length, 21);
  assert.ok(types.some((t) => t.id === 'mixed'));
});

test('getBusinessType returns null for unknown id, not throw', () => {
  assert.equal(getBusinessType('nonexistent'), null);
  assert.ok(getBusinessType('hotpot'));
});

test('getKpiWeights falls back to mixed weights for types without an explicit matrix', () => {
  const hotpotWeights = getKpiWeights('hotpot');
  assert.equal(hotpotWeights.table_turnover_rate, 10);
  const unknownTypeWeights = getKpiWeights('bar'); // not explicitly in KPI_WEIGHTS
  assert.deepEqual(unknownTypeWeights, getKpiWeights('mixed'));
});

test('classifyScale prefers seat count, falls back to daily revenue proxy', () => {
  assert.equal(classifyScale({ seatCount: 50 }), 'S');
  assert.equal(classifyScale({ avgDailyRevenue: 1500 }), 'XS');
  assert.equal(classifyScale({ avgDailyRevenue: 25000 }), 'L');
  assert.equal(classifyScale({ avgDailyRevenue: 999999 }), 'XXL');
});

test('classifyPriceBand buckets avg ticket price into the right band', () => {
  assert.equal(classifyPriceBand(45), 'budget');
  assert.equal(classifyPriceBand(100), 'value');
  assert.equal(classifyPriceBand(200), 'premium');
  assert.equal(classifyPriceBand(300), 'luxury');
  assert.equal(classifyPriceBand(600), 'ultra');
});
