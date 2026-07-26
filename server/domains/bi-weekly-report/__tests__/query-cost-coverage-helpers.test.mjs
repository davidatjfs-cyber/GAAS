import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCostCoverageBaseCteSql,
  buildCostCoverageSummarySql,
  buildCostCoverageUnmatchedSql,
  aggregateCostCoverageResults,
  runQueryCostCoverageDiagnostics,
} from '../query-cost-coverage-helpers.js';

const SQL_DEPS = {
  BIZ_NORMALIZE_SQL: "CASE WHEN s.biz_type='dinein' THEN 'dinein' END",
  DISH_NAME_NORMALIZE_SQL: (expr) => `lower(${expr})`,
  BIZ_MATCH_WHERE_SQL: (a, b) => `${a} = ${b}`,
  BIZ_PRIORITY_SQL: (a, b) => `CASE WHEN ${a}=${b} THEN 0 ELSE 1 END`,
};

test('buildCostCoverageBaseCteSql includes pos_sales_detail and dish_library_costs', () => {
  const sql = buildCostCoverageBaseCteSql(SQL_DEPS);
  assert.match(sql, /pos_sales_detail/);
  assert.match(sql, /dish_name_aliases/);
  assert.match(sql, /dish_library_costs/);
  assert.match(sql, /WITH sales AS/);
  assert.match(sql, /priced AS/);
});

test('buildCostCoverageSummarySql groups by biz_type', () => {
  const sql = buildCostCoverageSummarySql(SQL_DEPS);
  assert.match(sql, /GROUP BY biz_type/);
  assert.match(sql, /covered_sales/);
});

test('buildCostCoverageUnmatchedSql filters null unit_cost', () => {
  const sql = buildCostCoverageUnmatchedSql(SQL_DEPS);
  assert.match(sql, /WHERE unit_cost IS NULL/);
  assert.match(sql, /LIMIT \$4/);
});

test('aggregateCostCoverageResults: computes byBiz and totals', () => {
  const out = aggregateCostCoverageResults(
    [
      { biz_type: 'dinein', total_sales: 100, covered_sales: 80, total_revenue: 90, covered_revenue: 70 },
      { biz_type: 'takeaway', total_sales: 50, covered_sales: 25, total_revenue: 40, covered_revenue: 20 },
    ],
    [
      { biz_type: 'dinein', dish_name: 'A', resolved_dish_name: 'A', sales: 10, revenue: 8, qty: 2 },
    ]
  );
  assert.equal(out.byBiz.dinein.totalSales, 100);
  assert.equal(out.byBiz.dinein.salesCoveragePct, 80);
  assert.equal(out.byBiz.takeaway.totalSales, 50);
  assert.equal(out.total.totalSales, 150);
  assert.equal(out.total.coveredSales, 105);
  assert.equal(out.total.salesCoveragePct, 70);
  assert.equal(out.unmatchedTop.length, 1);
  assert.equal(out.unmatchedTop[0].dishName, 'A');
});

test('aggregateCostCoverageResults: ignores unknown biz types', () => {
  const out = aggregateCostCoverageResults(
    [{ biz_type: 'other', total_sales: 999, covered_sales: 999, total_revenue: 999, covered_revenue: 999 }],
    []
  );
  assert.equal(out.byBiz.dinein.totalSales, 0);
  assert.equal(out.total.totalSales, 0);
});

test('aggregateCostCoverageResults: zero denominator yields null pct', () => {
  const out = aggregateCostCoverageResults([], []);
  assert.equal(out.byBiz.dinein.salesCoveragePct, null);
  assert.equal(out.total.salesCoveragePct, null);
});

test('runQueryCostCoverageDiagnostics: runs summary + unmatched queries', async () => {
  const pool = {
    query: async (_sql, params) => {
      if (params.length === 4) {
        return { rows: [{ biz_type: 'dinein', dish_name: 'X', resolved_dish_name: 'X', sales: 5, revenue: 4, qty: 1 }] };
      }
      return { rows: [{ biz_type: 'dinein', total_sales: 200, covered_sales: 100, total_revenue: 180, covered_revenue: 90 }] };
    },
  };
  const out = await runQueryCostCoverageDiagnostics(pool, 'StoreA', '2026-07-01', '2026-07-07', 5, SQL_DEPS);
  assert.equal(out.byBiz.dinein.totalSales, 200);
  assert.equal(out.unmatchedTop[0].dishName, 'X');
});

test('runQueryCostCoverageDiagnostics: clamps high limit to 30', async () => {
  let limitParam;
  const pool = {
    query: async (_sql, params) => {
      if (params.length === 4) limitParam = params[3];
      return { rows: [] };
    },
  };
  await runQueryCostCoverageDiagnostics(pool, 'S', '2026-07-01', '2026-07-07', 999, SQL_DEPS);
  assert.equal(limitParam, 30);
});

test('runQueryCostCoverageDiagnostics: negative limit clamps to 1', async () => {
  let limitParam;
  const pool = {
    query: async (_sql, params) => {
      if (params.length === 4) limitParam = params[3];
      return { rows: [] };
    },
  };
  await runQueryCostCoverageDiagnostics(pool, 'S', '2026-07-01', '2026-07-07', -1, SQL_DEPS);
  assert.equal(limitParam, 1);
});
