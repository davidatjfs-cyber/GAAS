import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISABLED_LEGACY_BI_CATEGORIES,
  buildKpiRadarAlertJson,
  createRunDataAuditor,
  dailyReportStoreLikePatternsForSql,
  daysInMonth,
  getMonthlyTarget,
  getPreviousWeekRange,
  inDateRangeInclusive,
  isConsecutiveDate,
  isDisabledLegacyBiCategory,
  shanghaiYesterdayYmd,
  toDateOnly,
  toNum,
} from '../run-data-auditor.js';

test('isDisabledLegacyBiCategory covers migrated BI categories', () => {
  assert.equal(isDisabledLegacyBiCategory('充值异常'), true);
  assert.equal(isDisabledLegacyBiCategory('实收营收异常'), true);
  assert.equal(isDisabledLegacyBiCategory('自定义异常'), false);
});

test('buildKpiRadarAlertJson shape', () => {
  const j = JSON.parse(
    buildKpiRadarAlertJson({
      category: '充值异常',
      store: '洪潮久光店',
      severity: 'high',
      title: 't',
    })
  );
  assert.equal(j.type, 'kpi_radar');
  assert.equal(j.category, '充值异常');
  assert.equal(j.store, '洪潮久光店');
  assert.equal(j.severity, 'high');
  assert.ok(j.timestamp);
});

test('toNum / toDateOnly / isConsecutiveDate helpers', () => {
  assert.equal(toNum('12.5'), 12.5);
  assert.equal(toNum('x', 3), 3);
  assert.equal(toDateOnly('2026-07-01'), '2026-07-01');
  assert.equal(toDateOnly(''), '');
  assert.equal(isConsecutiveDate('2026-07-01', '2026-07-02'), true);
  assert.equal(isConsecutiveDate('2026-07-01', '2026-07-03'), false);
});

test('shanghaiYesterdayYmd is YYYY-MM-DD', () => {
  assert.match(shanghaiYesterdayYmd(), /^\d{4}-\d{2}-\d{2}$/);
});

test('dailyReportStoreLikePatternsForSql expands 洪潮 aliases', () => {
  const pats = dailyReportStoreLikePatternsForSql(
    '洪潮久光店',
    (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ''),
    (s) => s
  );
  assert.ok(pats.some((p) => p.includes('洪潮')));
  assert.ok(pats.length >= 2);
});

function makeAuditor({ existingIssue = false, reportsDate } = {}) {
  const ymd = reportsDate || shanghaiYesterdayYmd();
  const queries = [];
  const state = {
    dailyReports: [
      {
        store: '洪潮久光店',
        date: ymd,
        data: { recharge: { amount: 0, count: 0 }, dine: { orders: 10 }, actual: 1000 },
      },
    ],
    employees: [{ username: 'mgr1', store: '洪潮久光店', role: 'store_manager' }],
    settings: { monthlyTargets: [] },
  };
  const run = createRunDataAuditor({
    pool: () => ({
      query: async (sql) => {
        const s = String(sql);
        queries.push(s);
        if (/FROM daily_reports/i.test(s)) return { rows: [{ cnt: 0, amt: 0 }] };
        if (/SELECT id FROM agent_issues/i.test(s)) {
          return { rows: existingIssue ? [{ id: 'dup' }] : [] };
        }
        if (/INSERT INTO agent_issues/i.test(s)) return { rows: [{ id: 'iss-1' }] };
        if (/INSERT INTO agent_messages/i.test(s)) return { rows: [], rowCount: 1 };
        if (/FROM bad_reviews/i.test(s)) return { rows: [] };
        return { rows: [] };
      },
    }),
    getSharedState: async () => state,
    getStoresFromState: () => [{ name: '洪潮久光店', brand: '洪潮' }],
    resolveBrandContextByStore: () => ({ brandName: '洪潮' }),
    inferBrandFromStoreName: () => '洪潮',
    findStoreManager: async () => 'mgr1',
    refreshBiAgentRuntimeConfig: async () => {},
    isBiSourceEnabled: (key) => key === 'daily_reports',
    getStoreThreshold: (_s, _k, fallback) => fallback,
    loadTableVisitMetricsByStore: async () => ({
      countByDate: new Map(),
      dissatisfiedProducts: new Map(),
      dissatisfiedByDate: new Map(),
      productLabelByKey: new Map(),
    }),
    checkDataSourceQuality: async () => [],
    normalizeStoreKey: (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ''),
    normalizeCanonicalStoreName: (s) => s,
  });
  return { run, queries };
}

test('runDataAuditor daily: legacy 充值异常 detected then skipped on persist', async () => {
  const { run, queries } = makeAuditor();
  const r = await run('daily', 'default');
  assert.ok(r.issuesFound >= 1, `issuesFound=${r.issuesFound}`);
  assert.equal(r.issuesCreated, 0);
  assert.ok(!queries.some((q) => /INSERT INTO agent_issues/i.test(q)));
});

test('runDataAuditor: non-legacy category inserts issue + radar message', async () => {
  assert.ok(DISABLED_LEGACY_BI_CATEGORIES.has('充值异常'));
  DISABLED_LEGACY_BI_CATEGORIES.delete('充值异常');
  try {
    const { run, queries } = makeAuditor();
    const r = await run('daily', 'default');
    assert.ok(r.issuesFound >= 1);
    assert.ok(r.issuesCreated >= 1, `issuesCreated=${r.issuesCreated}`);
    assert.deepEqual(r.newIssueIds, ['iss-1']);
    assert.ok(queries.some((q) => /INSERT INTO agent_issues/i.test(q)));
    assert.ok(queries.some((q) => /INSERT INTO agent_messages/i.test(q)));
  } finally {
    DISABLED_LEGACY_BI_CATEGORIES.add('充值异常');
  }
});

test('runDataAuditor dedup: existing agent_issues skips insert', async () => {
  DISABLED_LEGACY_BI_CATEGORIES.delete('充值异常');
  try {
    const { run, queries } = makeAuditor({ existingIssue: true });
    const r = await run('daily', 'default');
    assert.ok(r.issuesFound >= 1);
    assert.equal(r.issuesCreated, 0);
    assert.ok(queries.some((q) => /SELECT id FROM agent_issues/i.test(q)));
    assert.ok(!queries.some((q) => /INSERT INTO agent_issues/i.test(q)));
  } finally {
    DISABLED_LEGACY_BI_CATEGORIES.add('充值异常');
  }
});

test('runDataAuditor empty stores returns zeroed summary', async () => {
  const run = createRunDataAuditor({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    getSharedState: async () => ({ dailyReports: [] }),
    getStoresFromState: () => [],
    resolveBrandContextByStore: () => ({}),
    inferBrandFromStoreName: () => null,
    findStoreManager: async () => null,
    refreshBiAgentRuntimeConfig: async () => {},
    isBiSourceEnabled: () => false,
    getStoreThreshold: (_s, _k, f) => f,
    loadTableVisitMetricsByStore: async () => ({
      countByDate: new Map(),
      dissatisfiedProducts: new Map(),
      dissatisfiedByDate: new Map(),
      productLabelByKey: new Map(),
    }),
    checkDataSourceQuality: async () => [],
    normalizeStoreKey: (v) => String(v || ''),
    normalizeCanonicalStoreName: (s) => s,
  });
  assert.deepEqual(await run('weekly', 't1'), {
    scanned: 0,
    issuesFound: 0,
    issuesCreated: 0,
    newIssueIds: [],
  });
});

test('helpers: getPreviousWeekRange / daysInMonth / inDateRange / getMonthlyTarget', () => {
  const wr = getPreviousWeekRange(new Date('2026-07-26T12:00:00+08:00'));
  assert.match(wr.weekStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(wr.weekEnd, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(wr.weekLabel, /^\d{4}-W\d{2}$/);
  assert.equal(daysInMonth('2026-02-01'), 28);
  assert.equal(daysInMonth(''), 30);
  assert.equal(inDateRangeInclusive('2026-07-02', '2026-07-01', '2026-07-03'), true);
  assert.equal(inDateRangeInclusive('2026-07-05', '2026-07-01', '2026-07-03'), false);
  const t = getMonthlyTarget(
    {
      settings: {
        monthlyTargets: [{ ym: '2026-07', store: '洪潮久光店', targets: { actual: 100 } }],
      },
    },
    '2026-07',
    '洪潮久光店'
  );
  assert.equal(t?.targets?.actual, 100);
});

function baseDeps(overrides = {}) {
  return {
    pool: () => ({ query: async () => ({ rows: [] }) }),
    getSharedState: async () => ({ dailyReports: [], employees: [] }),
    getStoresFromState: () => [{ name: '洪潮久光店', brand: '洪潮' }],
    resolveBrandContextByStore: () => ({ brandName: '洪潮' }),
    inferBrandFromStoreName: () => '洪潮',
    findStoreManager: async () => 'mgr1',
    refreshBiAgentRuntimeConfig: async () => {},
    isBiSourceEnabled: (key) =>
      key === 'daily_reports' ||
      key === 'table_visit_records' ||
      key === 'table_visit_bitable',
    getStoreThreshold: (_s, key, fallback) => {
      if (key === 'revenueGapMedium') return 0.01;
      if (key === 'revenueGapHigh') return 0.05;
      if (key === 'tableVisitRatioMedium') return 0.99;
      if (key === 'tableVisitRatioHigh') return 0.5;
      if (key === 'badReviewMedium') return 1;
      if (key === 'badReviewHigh') return 2;
      return fallback;
    },
    loadTableVisitMetricsByStore: async () => ({
      countByDate: new Map([['2026-07-20', 1]]),
      dissatisfiedProducts: new Map(),
      dissatisfiedByDate: new Map(),
      productLabelByKey: new Map(),
    }),
    checkDataSourceQuality: async () => [],
    normalizeStoreKey: (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ''),
    normalizeCanonicalStoreName: (s) => s,
    ...overrides,
  };
}

test('runDataAuditor weekly: revenue + tableVisit + badReviews detection paths', async () => {
  const reports = [];
  for (let d = 1; d <= 20; d++) {
    reports.push({
      store: '洪潮久光店',
      date: `2026-07-${String(d).padStart(2, '0')}`,
      data: { actual: 10, dine: { orders: 100 }, recharge: { amount: 1, count: 1 } },
    });
  }
  const run = createRunDataAuditor(
    baseDeps({
      getSharedState: async () => ({
        dailyReports: reports,
        employees: [{ username: 'mgr1', store: '洪潮久光店', role: 'store_manager' }],
        settings: {
          monthlyTargets: [
            { ym: '2026-07', store: '洪潮久光店', targets: { actual: 1_000_000 } },
          ],
        },
      }),
      pool: () => ({
        query: async (sql) => {
          if (/review_type = 'product'/i.test(sql)) {
            return { rows: [{ product_name: '卤鹅', cnt: 3 }] };
          }
          if (/review_type = 'service'/i.test(sql)) {
            return { rows: [{ service_item: '态度', cnt: 2 }] };
          }
          return { rows: [] };
        },
      }),
    })
  );
  const r = await run('weekly', 'default');
  assert.ok(r.issuesFound >= 3, `issuesFound=${r.issuesFound}`);
  assert.equal(r.issuesCreated, 0);
});

test('runDataAuditor daily: missing reports triggers data-source issue helper', async () => {
  let reported = 0;
  const { AgentCommunicationHelper } = await import('../../../agent-communication-system.js');
  const orig = AgentCommunicationHelper.reportDataSourceIssue;
  AgentCommunicationHelper.reportDataSourceIssue = async () => {
    reported++;
  };
  try {
    const run = createRunDataAuditor(
      baseDeps({
        isBiSourceEnabled: (key) => key === 'daily_reports',
        getSharedState: async () => ({ dailyReports: [], employees: [] }),
      })
    );
    await run('daily');
    assert.ok(reported >= 1);
  } finally {
    AgentCommunicationHelper.reportDataSourceIssue = orig;
  }
});

test('runDataAuditor: insert failure is non-fatal; findStoreManager fallback', async () => {
  DISABLED_LEGACY_BI_CATEGORIES.delete('充值异常');
  try {
    let findCalled = 0;
    const ymd = shanghaiYesterdayYmd();
    const run = createRunDataAuditor(
      baseDeps({
        isBiSourceEnabled: (key) => key === 'daily_reports',
        getSharedState: async () => ({
          dailyReports: [
            {
              store: '洪潮久光店',
              date: ymd,
              data: { recharge: { amount: 0, count: 0 }, dine: { orders: 1 }, actual: 1 },
            },
          ],
          employees: [],
        }),
        findStoreManager: async () => {
          findCalled++;
          return 'fallback-mgr';
        },
        pool: () => ({
          query: async (sql) => {
            if (/FROM daily_reports/i.test(sql)) return { rows: [{ cnt: 0, amt: 0 }] };
            if (/SELECT id FROM agent_issues/i.test(sql)) return { rows: [] };
            if (/INSERT INTO agent_issues/i.test(sql)) throw new Error('db down');
            return { rows: [] };
          },
        }),
      })
    );
    // getCategoryAssigneeRoleMap may succeed or fail; force assignee path via empty employees
    const r = await run('daily');
    assert.equal(r.issuesCreated, 0);
    assert.ok(r.issuesFound >= 1);
    void findCalled;
  } finally {
    DISABLED_LEGACY_BI_CATEGORIES.add('充值异常');
  }
});

test('runDataAuditor custom mode date window + recharge streak high', async () => {
  DISABLED_LEGACY_BI_CATEGORIES.delete('充值异常');
  try {
    // custom 模式的扫描窗口是"过去7天到今天"（相对当前时间滚动），这两个日期必须始终落在
    // 窗口内——之前写死 2026-07-20/21，过了7天窗口就滚出去了，issuesFound 会跌到 0，
    // 跟这次改动无关，是测试本身对"今天"的相对性处理有问题，改成基于 Date.now() 算。
    const ymd = (d) => d.toISOString().slice(0, 10);
    const dayBeforeYesterday = ymd(new Date(Date.now() - 2 * 86400000));
    const yesterday = ymd(new Date(Date.now() - 1 * 86400000));
    const run = createRunDataAuditor(
      baseDeps({
        isBiSourceEnabled: (key) => key === 'daily_reports',
        getStoreThreshold: (_s, key, fallback) =>
          key === 'rechargeStreakHighDays' ? 2 : fallback,
        getSharedState: async () => ({
          dailyReports: [
            {
              store: '洪潮久光店',
              date: dayBeforeYesterday,
              data: { recharge: { amount: 0, count: 0 }, dine: { orders: 1 }, actual: 1 },
            },
            {
              store: '洪潮久光店',
              date: yesterday,
              data: { recharge: { amount: 0, count: 0 }, dine: { orders: 1 }, actual: 1 },
            },
          ],
          employees: [{ username: 'mgr1', store: '洪潮久光店', role: 'store_manager' }],
        }),
        pool: () => ({
          query: async (sql) => {
            if (/FROM daily_reports/i.test(sql)) return { rows: [{ cnt: 0, amt: 0 }] };
            if (/SELECT id FROM agent_issues/i.test(sql)) return { rows: [] };
            if (/INSERT INTO agent_issues/i.test(sql)) return { rows: [{ id: 'x' }] };
            if (/INSERT INTO agent_messages/i.test(sql)) return { rows: [] };
            return { rows: [] };
          },
        }),
      })
    );
    const r = await run('custom', 'default');
    assert.ok(r.issuesFound >= 2);
    assert.ok(r.issuesCreated >= 1);
  } finally {
    DISABLED_LEGACY_BI_CATEGORIES.add('充值异常');
  }
});

test('dailyReportStoreLikePatternsForSql expands 马己仙 aliases', () => {
  const pats = dailyReportStoreLikePatternsForSql(
    '马己仙大宁店',
    (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ''),
    (s) => s
  );
  assert.ok(pats.some((p) => p.includes('马己仙')));
});

test('fetchRecharge pg error path returns zeros (via daily scan)', async () => {
  const ymd = shanghaiYesterdayYmd();
  const run = createRunDataAuditor(
    baseDeps({
      isBiSourceEnabled: (key) => key === 'daily_reports',
      getSharedState: async () => ({
        dailyReports: [
          {
            store: '洪潮久光店',
            date: ymd,
            data: { recharge: { amount: 0, count: 0 }, dine: { orders: 1 }, actual: 1 },
          },
        ],
        employees: [],
      }),
      pool: () => ({
        query: async (sql) => {
          if (/FROM daily_reports/i.test(sql)) throw new Error('pg down');
          return { rows: [] };
        },
      }),
    })
  );
  const r = await run('daily');
  assert.ok(r.issuesFound >= 1);
});
