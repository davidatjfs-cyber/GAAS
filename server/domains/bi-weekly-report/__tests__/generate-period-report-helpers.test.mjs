import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePeriodHasTakeaway,
  fetchPeriodDataQualityRange,
  fetchPeriodFallbackDaily,
  applyPeriodAlignmentWarnings,
  fetchPeriodPosAnalytics,
  fetchPeriodMarginSections,
  appendCostCoverageWarnings,
  fetchPeriodWowSection,
  runGeneratePeriodReport,
} from '../generate-period-report-helpers.js';

const BIZ_TYPES = ['dinein', 'takeaway'];
const COST_COVERAGE_WARN_THRESHOLD_PCT = 90;

function baseDeps(overrides = {}) {
  return {
    resolveTenantIdDefault: () => 'default',
    getStoreHasTakeawaySync: () => null,
    STORE_NO_TAKEAWAY: new Set(['洪潮大宁久光店']),
    dailyReportIlikePatterns: (s) => [`%${s}%`],
    daysBetweenInclusive: () => 7,
    shiftRangeBackward: () => ({ start: '2026-06-24', end: '2026-06-30' }),
    wow: (c, p) => (p === 0 ? null : ((c - p) / p) * 100),
    shouldExcludeDish: (name) => String(name || '').includes('赠品'),
    BIZ_TYPES,
    COST_COVERAGE_WARN_THRESHOLD_PCT,
    queryMarginByBiz: async () => ({
      margins: { totalNetMarginPct: 50 },
      total: { sales: 100 },
      byBiz: { dinein: { sales: 80 }, takeaway: { sales: 20 } },
    }),
    querySalesRawTotals: async () => ({ gross: 1000, net: 900 }),
    querySalesRawTotalsBySlot: async () => ({ lunch: { gross: 500, net: 450 } }),
    queryMarginBySlot: async () => ({ lunch: { margins: { netMarginPct: 55 } } }),
    queryCostCoverageDiagnostics: async () => ({
      byBiz: { dinein: { salesCoveragePct: 95 }, takeaway: { salesCoveragePct: 85 } },
    }),
    querySalesRawTotalsDinein: async () => ({ gross: 800, net: 700 }),
    querySalesRawTotalsTakeaway: async () => ({ gross: 200, net: 200 }),
    buildAnalysisSummary: () => ['insight'],
    resolveStoreKeyForReports: async (s) => ({ useStore: s, note: '' }),
    pool: {
      query: async (sql) => {
        if (sql.includes('MIN(date)')) {
          return { rows: [{ actual_start: '2026-07-01', actual_end: '2026-07-07', data_days: 7, missing_revenue_rows: 0, valid_sales_rows: 100 }] };
        }
        if (sql.includes('AVG(EXTRACT')) {
          return { rows: [{ slot: 'lunch', avg_min: 45, cnt: 10 }] };
        }
        if (sql.includes('GROUP BY biz_type, dish_name')) {
          return {
            rows: [
              { biz_type: 'dinein', dish_name: '菜A', total_qty: 10, total_sales: 1000 },
              { biz_type: 'dinein', dish_name: '赠品面', total_qty: 1, total_sales: 0 },
              { biz_type: 'takeaway', dish_name: '菜B', total_qty: 5, total_sales: 200 },
            ],
          };
        }
        if (sql.includes('GROUP BY weekday, biz_type')) {
          return { rows: [{ weekday: 1, biz_type: 'dinein', order_cnt: 5, total_sales: 500 }] };
        }
        if (sql.includes('EXTRACT(HOUR')) {
          return { rows: [{ weekday: 1, hour: 12, biz_type: 'dinein', cnt: 3 }] };
        }
        if (sql.includes('daily_reports')) {
          return { rows: [{ dr_days: 5, revenue: 50000, orders: 100 }] };
        }
        return { rows: [] };
      },
    },
    ...overrides,
  };
}

test('resolvePeriodHasTakeaway: uses db cache when available', () => {
  const out = resolvePeriodHasTakeaway('店A', '店A', {
    resolveTenantIdDefault: () => 'default',
    getStoreHasTakeawaySync: () => false,
    STORE_NO_TAKEAWAY: new Set(),
  });
  assert.equal(out, false);
});

test('resolvePeriodHasTakeaway: falls back to STORE_NO_TAKEAWAY set', () => {
  const out = resolvePeriodHasTakeaway('洪潮大宁久光店', '洪潮大宁久光店', {
    resolveTenantIdDefault: () => 'default',
    getStoreHasTakeawaySync: () => null,
    STORE_NO_TAKEAWAY: new Set(['洪潮大宁久光店']),
  });
  assert.equal(out, false);
});

test('fetchPeriodDataQualityRange: warns when missing revenue pct > 10', async () => {
  const pool = {
    query: async () => ({
      rows: [{ actual_start: '2026-07-01', actual_end: '2026-07-07', data_days: 7, missing_revenue_rows: 20, valid_sales_rows: 100 }],
    }),
  };
  const out = await fetchPeriodDataQualityRange(pool, '店A', '2026-07-01', '2026-07-07', ['店A', '2026-07-01', '2026-07-07']);
  assert.equal(out.dataQualityWarnings.length, 1);
  assert.match(out.dataQualityWarnings[0], /20\/100/);
  assert.equal(out.actualDateRange.dataDays, 7);
});

test('fetchPeriodFallbackDaily: returns wow metrics', async () => {
  let call = 0;
  const pool = {
    query: async () => {
      call += 1;
      if (call === 1) return { rows: [{ dr_days: 5, revenue: 1000, orders: 50 }] };
      return { rows: [{ revenue: 800, orders: 40 }] };
    },
  };
  const out = await fetchPeriodFallbackDaily(pool, '店A', '店A', '2026-07-01', '2026-07-07', baseDeps());
  assert.equal(out.current.revenue, 1000);
  assert.equal(out.previous.revenue, 800);
  assert.ok(out.revenueWowPct > 0);
});

test('fetchPeriodFallbackDaily: returns null on error', async () => {
  const pool = { query: async () => { throw new Error('db down'); } };
  const out = await fetchPeriodFallbackDaily(pool, '店A', '店A', '2026-07-01', '2026-07-07', baseDeps());
  assert.equal(out, null);
});

test('applyPeriodAlignmentWarnings: prepends align note and zero-row warning', () => {
  const report = { dataQualityWarnings: ['existing'] };
  applyPeriodAlignmentWarnings(report, { note: 'align note' }, { data_days: 0 }, '店DB');
  assert.equal(report.dataQualityWarnings[0], 'align note');
  assert.equal(report.dataQualityWarnings[1], 'existing');
  assert.match(report.dataQualityWarnings[2], /零行/);
});

test('fetchPeriodPosAnalytics: excludes dishes and builds rankings', async () => {
  const pool = baseDeps().pool;
  const out = await fetchPeriodPosAnalytics(pool, ['店A', '2026-07-01', '2026-07-07'], baseDeps());
  assert.equal(out.diningDuration.length, 1);
  assert.equal(out.rankingSections.ranking_dinein.top10.length, 1);
  assert.equal(out.rankingSections.ranking_dinein.top10[0].dish_name, '菜A');
  assert.equal(out.rankingSections.ranking_takeaway.top10.length, 1);
  assert.equal(out.weekdayRatios.length, 1);
  assert.equal(out.hourlyOrders.length, 1);
});

test('fetchPeriodMarginSections: aggregates margin bundle', async () => {
  const out = await fetchPeriodMarginSections('店A', '2026-07-01', '2026-07-07', baseDeps());
  assert.equal(out.salesRawTotals.net, 900);
  assert.equal(out.theoreticalMargins.totals.dinein.sales, 80);
  assert.equal(out.costCoverage.byBiz.dinein.salesCoveragePct, 95);
});

test('appendCostCoverageWarnings: adds low coverage warnings', () => {
  const report = { dataQualityWarnings: [], hasTakeaway: true };
  appendCostCoverageWarnings(report, {
    byBiz: { dinein: { salesCoveragePct: 80 }, takeaway: { salesCoveragePct: 85 } },
  }, true, baseDeps());
  assert.equal(report.dataQualityWarnings.length, 2);
});

test('fetchPeriodWowSection: uses fallback daily revenue when available', async () => {
  const report = {
    sections: {
      fallbackDaily: {
        current: { days: 3, revenue: 6000 },
        previous: { revenue: 5000 },
      },
    },
  };
  const marginBundle = {
    salesRawTotals: { net: 9000 },
    dineinRawTotalsForWow: { gross: 8000 },
    currentMargin: { margins: { totalNetMarginPct: 50 } },
  };
  const out = await fetchPeriodWowSection(report, '店A', '2026-07-01', '2026-07-07', marginBundle, baseDeps());
  assert.equal(out.headlineUsesDailyRevenue, true);
  assert.ok(out.revenueWowPct > 0);
});

test('runGeneratePeriodReport: builds full report shell', async () => {
  const report = await runGeneratePeriodReport(baseDeps(), '测试店', '2026-07-01', '2026-07-07', 'weekly');
  assert.equal(report.store, '测试店');
  assert.equal(report.reportType, 'weekly');
  assert.equal(report.sections.analysisSummary.length, 1);
  assert.ok(report.sections.ranking_dinein);
  assert.ok(report.sections.wow);
  assert.equal(report.actualDateRange.dataDays, 7);
});

test('runGeneratePeriodReport: monthly reportType preserved', async () => {
  const report = await runGeneratePeriodReport(baseDeps(), '测试店', '2026-07-01', '2026-07-31', 'monthly');
  assert.equal(report.reportType, 'monthly');
});
