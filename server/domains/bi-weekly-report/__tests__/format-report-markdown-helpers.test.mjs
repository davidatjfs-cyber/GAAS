import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMarkdownFormatters,
  formatReportHeader,
  formatReportExecutiveSummary,
  formatReportMarginSection,
  formatReportSlotSection,
  formatReportDiningDuration,
  formatReportRankingSection,
  formatReportWeekdayRatios,
  formatReportHourlyPeaks,
  formatReportAnalysisSummary,
  formatReportUnmatchedAppendix,
  composeReportMarkdown,
} from '../format-report-markdown-helpers.js';

const BIZ_CN = { dinein: '堂食', takeaway: '外卖' };
const SLOT_CN = { lunch: '午市', afternoon: '下午茶', dinner: '晚市', other: '其他时段' };
const WEEKDAY_CN = { 1: '周一', 2: '周二' };

function baseDeps() {
  return {
    COST_COVERAGE_GOOD_THRESHOLD_PCT: 95,
    COST_COVERAGE_WARN_THRESHOLD_PCT: 90,
    BIZ_TYPES: ['dinein', 'takeaway'],
    BIZ_CN,
    SLOT_TYPES: ['lunch', 'afternoon', 'dinner'],
    SLOT_CN,
    WEEKDAY_CN,
    wow: (c, p) => (p === 0 ? null : ((c - p) / p) * 100),
    pct: (n, d) => (d ? (n / d) * 100 : null),
  };
}

function sampleReport(overrides = {}) {
  return {
    store: '测试店',
    storeDbKey: '测试店DB',
    weekStart: '2026-07-01',
    weekEnd: '2026-07-07',
    reportType: 'weekly',
    hasTakeaway: true,
    actualDateRange: { start: '2026-07-01', end: '2026-07-07', dataDays: 7 },
    dataQualityWarnings: ['warn1'],
    sections: {
      fallbackDaily: {
        current: { days: 5, revenue: 50000, orders: 100 },
        previous: { revenue: 40000, orders: 80 },
        revenueWowPct: 25,
        ordersWowPct: 25,
      },
      salesRawTotals: { gross: 60000, net: 55000 },
      dineinRawTotals: { gross: 50000, net: 45000 },
      takeawayRawTotals: { gross: 10000, net: 10000 },
      wow: { salesWowPct: 10, revenueWowPct: 5, discountWowPct: -2, netMarginWowPct: 1 },
      theoreticalMargins: {
        totalNetMarginPct: 55,
        totalPreDiscountMarginPct: 60,
        dineinPreDiscountMarginPct: 58,
        dineinNetMarginPct: 53,
        takeawayPreDiscountMarginPct: 40,
        takeawayNetMarginPct: 35,
        totals: {
          total: { sales: 1000, revenue: 900, cost: 400 },
          dinein: { sales: 800, revenue: 700, cost: 300 },
          takeaway: { sales: 200, revenue: 200, cost: 100 },
        },
      },
      costCoverage: {
        total: { salesCoveragePct: 96, revenueCoveragePct: 94 },
        byBiz: {
          dinein: { salesCoveragePct: 97, revenueCoveragePct: 95 },
          takeaway: { salesCoveragePct: 88, revenueCoveragePct: 85 },
        },
        unmatchedTop: [{ bizType: 'dinein', dishName: '未知菜', resolvedDishName: '未知菜', sales: 100, revenue: 90, qty: 3 }],
      },
      slotMargins: {
        lunch: {
          total: { sales: 300, revenue: 280, cost: 100 },
          margins: { preDiscountMarginPct: 60, netMarginPct: 55 },
          byBiz: { dinein: { sales: 300, revenue: 280, cost: 100 } },
        },
      },
      slotRawTotals: { lunch: { gross: 500, net: 450 }, other: { gross: 0, net: 0 } },
      diningDuration: [{ slot: 'lunch', avg_min: 45, cnt: 10 }],
      ranking_dinein: {
        top10: [{ dish_name: '菜A', total_sales: 1000, total_qty: 50 }],
        bottom10: [{ dish_name: '菜Z', total_sales: 10, total_qty: 1 }],
      },
      ranking_takeaway: { top10: [], bottom10: [] },
      weekdayRatios: [{ weekday: 1, biz_type: 'dinein', order_cnt: 10, total_sales: 1000 }],
      hourlyOrders: [{ weekday: 1, hour: 12, biz_type: 'dinein', cnt: 5 }],
      analysisSummary: ['总结一', '总结二'],
    },
    ...overrides,
  };
}

test('createMarkdownFormatters: coverage labels by threshold', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  assert.match(fmt.coverageLabel(96), /✅/);
  assert.match(fmt.coverageLabel(92), /⚠️/);
  assert.match(fmt.coverageLabel(80), /🚨/);
  assert.equal(fmt.coverageLabel(null), '—（无数据）');
  assert.match(fmt.fmtMoney(15000), /万/);
  assert.equal(fmt.fmtMoney(500), '¥500');
  assert.match(fmt.fmtSignedPct(5), /↑/);
  assert.match(fmt.fmtSignedPct(-3), /↓/);
  assert.equal(fmt.fmtSignedPct(null), '—（无上期可对比）');
});

test('formatReportHeader includes store and warnings', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const md = formatReportHeader(sampleReport(), fmt, {
    reportMeta: { periodLabel: '周度', actualStart: '2026-07-01', actualEnd: '2026-07-07', dataDays: 7 },
  });
  assert.match(md, /测试店/);
  assert.match(md, /数据查询门店/);
  assert.match(md, /warn1/);
});

test('formatReportExecutiveSummary with fallback daily', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const { md, grossHeadline } = formatReportExecutiveSummary(sampleReport(), fmt, {
    reportMeta: { hasTakeaway: true, dataDays: 7 },
  });
  assert.match(md, /营业日报兜底/);
  assert.match(md, /经营主指标/);
  assert.match(md, /外卖/);
  assert.equal(grossHeadline, 50000);
});

test('formatReportExecutiveSummary zero dataDays branch', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const r = sampleReport({
    actualDateRange: { start: '2026-07-01', end: '2026-07-07', dataDays: 0 },
    sections: { ...sampleReport().sections, fallbackDaily: { current: { days: 2, revenue: 0, orders: 0 } } },
  });
  const { md } = formatReportExecutiveSummary(r, fmt, { reportMeta: { hasTakeaway: true, dataDays: 0 } });
  assert.match(md, /daily_reports/);
});

test('formatReportMarginSection includes margin table and coverage', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const md = formatReportMarginSection(sampleReport(), fmt, { reportMeta: { hasTakeaway: true } });
  assert.match(md, /理论毛利分析/);
  assert.match(md, /外卖/);
  assert.match(md, /成本覆盖率/);
});

test('formatReportSlotSection renders lunch slot', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const md = formatReportSlotSection(sampleReport(), fmt, {
    ...baseDeps(),
    reportMeta: { hasTakeaway: true },
    grossHeadline: 500,
  });
  assert.match(md, /午市/);
  assert.match(md, /堂食/);
});

test('formatReportSlotSection empty slots message', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const r = sampleReport({ sections: { ...sampleReport().sections, slotMargins: {}, slotRawTotals: {} } });
  const md = formatReportSlotSection(r, fmt, { ...baseDeps(), reportMeta: { hasTakeaway: false }, grossHeadline: 0 });
  assert.match(md, /无可用时段拆分销售/);
});

test('formatReportDiningDuration empty and populated', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  assert.match(formatReportDiningDuration(sampleReport(), fmt, baseDeps()), /45分钟/);
  const empty = sampleReport({ sections: { ...sampleReport().sections, diningDuration: [] } });
  assert.match(formatReportDiningDuration(empty, fmt, baseDeps()), /暂无可用/);
});

test('formatReportRankingSection top and bottom', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const md = formatReportRankingSection(sampleReport(), fmt, { reportMeta: { hasTakeaway: true }, ...baseDeps() });
  assert.match(md, /菜A/);
  assert.match(md, /菜Z/);
  assert.match(md, /暂无有效菜品数据/);
});

test('formatReportWeekdayRatios only when hasTakeaway', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  assert.match(formatReportWeekdayRatios(sampleReport(), fmt, { reportMeta: { hasTakeaway: true }, ...baseDeps() }), /周一/);
  assert.equal(formatReportWeekdayRatios(sampleReport(), fmt, { reportMeta: { hasTakeaway: false }, ...baseDeps() }), '');
});

test('formatReportHourlyPeaks renders peak/low', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const md = formatReportHourlyPeaks(sampleReport(), fmt, { reportMeta: { hasTakeaway: true }, ...baseDeps() });
  assert.match(md, /高峰/);
  assert.match(md, /12:00/);
});

test('formatReportAnalysisSummary with and without lines', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  assert.match(formatReportAnalysisSummary(sampleReport(), fmt, { reportMeta: { hasTakeaway: true } }), /总结一/);
  const empty = sampleReport({ sections: { ...sampleReport().sections, analysisSummary: [] } });
  assert.match(formatReportAnalysisSummary(empty, fmt, { reportMeta: { hasTakeaway: false } }), /暂无足够数据/);
});

test('formatReportUnmatchedAppendix renders appendix', () => {
  const fmt = createMarkdownFormatters(baseDeps());
  const md = formatReportUnmatchedAppendix(sampleReport(), fmt, baseDeps());
  assert.match(md, /未知菜/);
  const empty = sampleReport({ sections: { ...sampleReport().sections, costCoverage: { unmatchedTop: [] } } });
  assert.equal(formatReportUnmatchedAppendix(empty, fmt, baseDeps()), '');
});

test('composeReportMarkdown full report', () => {
  const md = composeReportMarkdown(sampleReport(), baseDeps());
  assert.match(md, /测试店/);
  assert.match(md, /执行摘要/);
  assert.match(md, /理论毛利分析/);
  assert.match(md, /附录：未匹配成本菜品TOP/);
  assert.match(md, /折扣 = 折前营收/);
});

test('composeReportMarkdown monthly label', () => {
  const md = composeReportMarkdown(sampleReport({ reportType: 'monthly' }), baseDeps());
  assert.match(md, /月度经营分析报告/);
});
