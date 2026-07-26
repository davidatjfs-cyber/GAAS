import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listBusinessTypes,
  getBusinessType,
  getKpiWeights,
  classifyBusinessType,
  classifyScale,
  classifyPriceBand,
} from './store-segments.js';

test('listBusinessTypes returns all segments', () => {
  const types = listBusinessTypes();
  assert.ok(types.length >= 20);
  assert.ok(types.some((t) => t.id === 'hotpot'));
});

test('getBusinessType resolves known id and null for unknown', () => {
  assert.equal(getBusinessType('hotpot').name, '火锅');
  assert.equal(getBusinessType('  hotpot  ').id, 'hotpot');
  assert.equal(getBusinessType('unknown_xyz'), null);
});

test('classifyBusinessType matches keywords and falls back to mixed', () => {
  assert.equal(classifyBusinessType('海底捞火锅'), 'hotpot');
  assert.equal(classifyBusinessType(''), 'mixed');
  assert.equal(classifyBusinessType('完全不认识的业态'), 'mixed');
});

test('classifyScale prefers seatCount when available', () => {
  assert.equal(classifyScale({ seatCount: 50 }), 'S');
  assert.equal(classifyScale({ seatCount: 200 }), 'L');
});

test('classifyScale uses avgDailyRevenue when no seats', () => {
  assert.equal(classifyScale({ avgDailyRevenue: 5000 }), 'S');
  assert.equal(classifyScale({ avgDailyRevenue: 999999 }), 'XXL');
});

test('classifyPriceBand maps ticket price to band', () => {
  assert.equal(classifyPriceBand(50), 'budget');
  assert.equal(classifyPriceBand(100), 'value');
  assert.equal(classifyPriceBand(300), 'luxury');
  assert.equal(classifyPriceBand(800), 'ultra');
});

test('getKpiWeights returns type-specific or mixed fallback', () => {
  const hotpot = getKpiWeights('hotpot');
  assert.equal(hotpot.table_turnover_rate, 10);
  const unknown = getKpiWeights('nonexistent_type');
  assert.equal(unknown.repeat_rate_30d, getKpiWeights('mixed').repeat_rate_30d);
});
