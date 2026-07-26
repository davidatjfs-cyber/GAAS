import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGrossProfileMap,
  getActualRevenueFromHistoryRow,
  estimateMarginMetricsForRange,
  resolveTrustedNetMarginForAuditorIssue,
} from '../margin-metrics-helpers.js';
import { createMarginMetricsApi } from '../margin-metrics.js';

const toNum = (v, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
const normProductKey = (v) => String(v || '').trim().toLowerCase();

function baseDeps(overrides = {}) {
  return {
    setReportPool: () => {},
    resolveStoreKeyForReports: async (s) => ({ useStore: s, note: null }),
    queryCostCoverageDiagnostics: async () => ({ total: { revenueCoveragePct: 90 } }),
    queryMarginByBiz: async () => ({
      margins: { totalNetMarginPct: 42 },
      total: { revenue: 1000, cost: 580 },
    }),
    ...overrides,
  };
}

test('getActualRevenueFromHistoryRow swaps inverted expected/actual', () => {
  assert.equal(
    getActualRevenueFromHistoryRow({ actualRevenue: 200, expectedRevenue: 100 }, toNum),
    100
  );
  assert.equal(
    getActualRevenueFromHistoryRow({ actualRevenue: 0, expectedRevenue: 100, totalDiscount: 20 }, toNum),
    80
  );
});

test('buildGrossProfileMap indexes by biz and product', () => {
  const map = buildGrossProfileMap(
    [{ store: '洪潮店', bizType: 'dinein', product: '牛肉', costPerUnit: 12 }],
    '洪潮店',
    { toNum, normProductKey }
  );
  assert.equal(map.get('dinein||牛肉')?.costPerUnit, 12);
  assert.equal(map.get('||牛肉')?.costPerUnit, 12);
});

test('estimateMarginMetricsForRange aggregates with dish library costs', async () => {
  const out = await estimateMarginMetricsForRange(
    {
      pool: () => ({
        query: async () => ({
          rows: [{ biz_type: 'dinein', dish_name: '牛肉', unit_cost: 10 }],
        }),
      }),
      log: { error() {} },
      toNum,
      normProductKey,
      inDateRangeInclusive: () => true,
      normalizeStoreKey: (s) => s,
    },
    {
      state: {
        inventoryForecastHistory: [
          {
            store: '洪潮店',
            date: '2026-07-01',
            bizType: 'dinein',
            actualRevenue: 100,
            expectedRevenue: 100,
            productQuantities: { 牛肉: 2 },
          },
        ],
        forecastGrossProfitProfiles: [],
      },
      store: '洪潮店',
      startDate: '2026-07-01',
      endDate: '2026-07-07',
    }
  );
  assert.ok(out.total.actualRevenue >= 100);
  assert.ok(out.dinein.estimatedCost > 0);
});

test('resolveTrustedNetMargin: pool / incomplete / low coverage / success / daily / none', async () => {
  const poolFail = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      setReportPool: () => {
        throw new Error('no pool');
      },
      pool: () => ({ query: async () => ({ rows: [] }) }),
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(poolFail.reason, 'pool');

  const incomplete = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      pool: () => ({
        query: async () => ({
          rows: [{ n: 10, sum_rev: 100, missing_rev_rows: 5, valid_sales_rows: 10 }],
        }),
      }),
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(incomplete.reason, 'pos_sales_incomplete_revenue');

  const lowCov = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      pool: () => ({
        query: async () => ({
          rows: [{ n: 10, sum_rev: 1000, missing_rev_rows: 0, valid_sales_rows: 10 }],
        }),
      }),
      queryCostCoverageDiagnostics: async () => ({ total: { revenueCoveragePct: 10 } }),
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(lowCov.reason, 'low_cost_coverage');

  const queryFail = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      pool: () => ({
        query: async () => ({
          rows: [{ n: 10, sum_rev: 1000, missing_rev_rows: 0, valid_sales_rows: 10 }],
        }),
      }),
      queryCostCoverageDiagnostics: async () => {
        throw new Error('cov down');
      },
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(queryFail.reason, 'query_failed');

  const noMargin = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      pool: () => ({
        query: async () => ({
          rows: [{ n: 10, sum_rev: 1000, missing_rev_rows: 0, valid_sales_rows: 10 }],
        }),
      }),
      queryMarginByBiz: async () => ({ margins: {}, total: {} }),
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(noMargin.reason, 'no_margin');

  const okPos = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      pool: () => ({
        query: async () => ({
          rows: [{ n: 10, sum_rev: 1000, missing_rev_rows: 0, valid_sales_rows: 10 }],
        }),
      }),
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(okPos.ok, true);
  assert.equal(okPos.source, 'pos_sales_detail_plus_cost_library');

  const okDaily = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      pool: () => ({
        query: async (sql) => {
          if (/pos_sales_detail/i.test(sql)) {
            return { rows: [{ n: 0, sum_rev: 0, missing_rev_rows: 0, valid_sales_rows: 0 }] };
          }
          return { rows: [{ av_g: 55.5, days_n: 3 }] };
        },
      }),
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(okDaily.ok, true);
  assert.equal(okDaily.source, 'daily_reports_pg');

  const none = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      pool: () => ({
        query: async (sql) => {
          if (/pos_sales_detail/i.test(sql)) {
            return { rows: [{ n: 0, sum_rev: 0, missing_rev_rows: 0, valid_sales_rows: 0 }] };
          }
          return { rows: [{ av_g: null, days_n: 0 }] };
        },
      }),
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(none.reason, 'no_trusted_source');

  const dailyFail = await resolveTrustedNetMarginForAuditorIssue(
    baseDeps({
      pool: () => ({
        query: async (sql) => {
          if (/pos_sales_detail/i.test(sql)) {
            return { rows: [{ n: 0, sum_rev: 0, missing_rev_rows: 0, valid_sales_rows: 0 }] };
          }
          throw new Error('dr down');
        },
      }),
    }),
    '洪潮店',
    '2026-07-01',
    '2026-07-07'
  );
  assert.equal(dailyFail.reason, 'daily_reports_failed');

  const api = createMarginMetricsApi(baseDeps({
    pool: () => ({
      query: async () => ({
        rows: [{ n: 10, sum_rev: 1000, missing_rev_rows: 0, valid_sales_rows: 10 }],
      }),
    }),
  }));
  const viaApi = await api.resolveTrustedNetMarginForAuditorIssue('洪潮店', '2026-07-01', '2026-07-07');
  assert.equal(viaApi.ok, true);
});
