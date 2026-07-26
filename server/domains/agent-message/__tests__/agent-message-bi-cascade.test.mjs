/**
 * BI 确定性级联编排单测（deps stub，无 DB）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tryBiDeterministicCascade } from '../bi-deterministic-cascade.js';

function baseCtx(overrides = {}) {
  return {
    text: '随便问一句',
    resolvedStore: '洪潮大宁久光店',
    route: 'data_auditor',
    store: '洪潮大宁久光店',
    brand: '洪潮',
    brandId: 'hc',
    brandConfig: {},
    ...overrides,
  };
}

function stubDeps(overrides = {}) {
  const calls = [];
  const track = (name, fn) => async (...args) => {
    calls.push(name);
    return fn(...args);
  };
  const deps = {
    buildCoverage: track('coverage', async () => null),
    buildDailyReport: track('daily', async () => null),
    buildTableVisit: track('tableVisit', async () => null),
    buildSalesRawTop: track('salesRawTop', async () => null),
    buildBadReview: track('badReview', async () => null),
    buildClosing: track('closing', async () => null),
    buildOpening: track('opening', async () => null),
    buildMaterial: track('material', async () => null),
    buildMeeting: track('meeting', async () => null),
    buildOpsCount: track('opsCount', async () => null),
    buildLoss: track('loss', async () => null),
    getSharedState: async () => ({}),
    normalizeStoreKey: (v) => String(v || ''),
    resolveDateRangeFromQuestion: () => ({ start: '2026-01-01', end: '2026-01-07', label: '近7天' }),
    buildSalesReport: () => null,
    ...overrides,
  };
  return { deps, calls };
}

test('coverage 命中后短路，不再调 daily', async () => {
  const { deps, calls } = stubDeps({
    buildCoverage: async () => '覆盖回复',
    buildDailyReport: async () => {
      throw new Error('should not call daily');
    },
  });
  const r = await tryBiDeterministicCascade(baseCtx({ text: '数据源覆盖' }), deps);
  assert.equal(r.handled, true);
  assert.equal(r.response, '覆盖回复');
  assert.equal(r.agentData.source, 'bi_data_source_coverage');
  assert.equal(r.agentData.deterministic, true);
  assert.deepEqual(calls, []);
});

test('全 miss → handled false', async () => {
  const { deps, calls } = stubDeps();
  const r = await tryBiDeterministicCascade(baseCtx(), deps);
  assert.equal(r.handled, false);
  assert.deepEqual(calls, [
    'coverage',
    'daily',
    'tableVisit',
    'salesRawTop',
    'badReview',
    'closing',
    'opening',
    'material',
    'meeting',
    'opsCount',
    'loss',
  ]);
});

test('inventory 有区间数据 → sales report', async () => {
  const { deps } = stubDeps({
    getSharedState: async () => ({
      inventoryForecastHistory: [
        { store: '洪潮大宁久光店', date: '2026-01-03', items: [] },
      ],
    }),
    resolveDateRangeFromQuestion: () => ({ start: '2026-01-01', end: '2026-01-07', label: '近7天' }),
    buildSalesReport: () => '销售明细报表',
  });
  const r = await tryBiDeterministicCascade(baseCtx({ text: '看看堂食销售明细' }), deps);
  assert.equal(r.handled, true);
  assert.equal(r.response, '销售明细报表');
  assert.equal(r.agentData.source, 'inventory_forecast');
});

test('inventory 区间无数据 → 范围提示', async () => {
  const { deps } = stubDeps({
    getSharedState: async () => ({
      inventoryForecastHistory: [
        { store: '洪潮大宁久光店', date: '2025-12-01', items: [] },
        { store: '洪潮大宁久光店', date: '2025-12-10', items: [] },
      ],
    }),
    resolveDateRangeFromQuestion: () => ({ start: '2026-01-01', end: '2026-01-07', label: '近7天' }),
  });
  const r = await tryBiDeterministicCascade(baseCtx({ text: '午市销量' }), deps);
  assert.equal(r.handled, true);
  assert.ok(r.response.includes('暂无销售明细数据'));
  assert.ok(r.response.includes('2025-12-01'));
  assert.equal(r.agentData.source, 'inventory_forecast');
});
