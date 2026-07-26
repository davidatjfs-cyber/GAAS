import test from 'node:test';
import assert from 'node:assert/strict';
import {
  num,
  severityByDrop,
  ruleEvidence,
  issueRow,
  resolveDiagnosisWindow,
  thresholdSafe,
  loadDiagnosisRulesSafe,
  applyRule,
  buildDiagnosisIssues,
  fetchDiagnosisStats,
  supersedeOpenDiagnosisRecords,
  persistDiagnosisIssues,
  orderStats,
  repeatStats,
  marketingStats,
  employeeStats,
  dormantCustomerStats,
  newCustomerSecondVisitStats,
  loadDiagnosisThresholds,
} from '../run-daily-diagnosis-helpers.js';

function makePool(queryFn) {
  return { query: queryFn || (async () => ({ rows: [] })) };
}

const baseThresholds = {
  dormantDaysMin: 90,
  dormantDaysMax: 180,
  minHistoricalVisitCount: 2,
  minTotalSpend: 300,
  newFirstVisitDaysMin: 7,
  newFirstVisitDaysMax: 14,
  revenueDeclineFallback: -8,
  repeatRateFallback: 0.35,
  marketingConversionFallback: 0.25,
  newCustomerNoSecondVisitMin: 5,
};

test('num / severityByDrop / resolveDiagnosisWindow', () => {
  assert.equal(num('12.5'), 12.5);
  assert.equal(num('bad'), 0);
  assert.equal(severityByDrop(-25), 'P1');
  assert.equal(severityByDrop(-10), 'P2');
  assert.equal(severityByDrop(-3), 'P3');
  const w = resolveDiagnosisWindow('2026-07-26');
  assert.ok(w.dayStart);
  assert.ok(w.dayEnd);
  assert.ok(w.prevStart);
  assert.ok(w.prevEnd);
});

test('ruleEvidence / issueRow', () => {
  const rule = { rule_id: 'r1', version: 2, rule_scope: 'tenant', confidence_base: 0.8, action_json: { x: 1 } };
  const ev = ruleEvidence(rule, ['c1'], { foo: 1 });
  assert.equal(ev.rule_id, 'r1');
  assert.deepEqual(ev.matched_conditions, ['c1']);
  const row = issueRow({
    tenantId: 'default', storeId: 's1', issueType: 'revenue_decline', title: 't',
    description: 'd', severity: 'P2', confidence: 0.8, evidence: ev, roots: ['a'], impact: 100,
  });
  assert.match(row.issue_id, /^issue_/);
  assert.equal(row.issue_type, 'revenue_decline');
  assert.equal(row.status, 'open');
});

test('thresholdSafe returns default on error', async () => {
  const pool = makePool(async () => { throw new Error('db down'); });
  const v = await thresholdSafe(pool, { tenantId: 'default', storeId: 's1', ruleId: 'x', thresholdKey: 'y', defaultValue: 42 });
  assert.equal(v, 42);
});

test('loadDiagnosisRulesSafe returns empty map when no rules', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const state = await loadDiagnosisRulesSafe(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(state.rules.length, 0);
  assert.equal(state.byId.size, 0);
  assert.equal(state.error, undefined);
});

test('applyRule without rule returns matched', async () => {
  const pool = makePool();
  const r = await applyRule(pool, null, {});
  assert.equal(r.matched, true);
  assert.deepEqual(r.matchedConditions, []);
});

test('buildDiagnosisIssues: revenue decline via fallback', async () => {
  const pool = makePool();
  const stats = {
    current: { revenue: 8000, orders: 0, customers: 0 },
    prev: { revenue: 10000, orders: 0, customers: 0 },
    repeat: { repeatRate: 0.5, riskCustomers: 0, customers: 10 },
    marketing: { touched: 0, returned: 0, conversionRate: null },
    employee: { avgScore: 0, lowCount: 0 },
    dormant: { priorityCustomerCount: 0, minLastVisitDays: 90, maxVisitCount: 0, maxTotalSpend: 0 },
    newCustomerSecondVisit: { noSecondVisit: 0, avgFirstSpend: 0 },
  };
  const { issues, dataGaps } = await buildDiagnosisIssues(pool, {
    tenantId: 'default', storeId: 's1', date: '2026-07-26',
    rules: new Map(), thresholds: baseThresholds, stats,
  });
  assert.equal(issues.some(i => i.issue_type === 'revenue_decline'), true);
  assert.equal(dataGaps.length, 1);
  assert.equal(dataGaps[0].code, 'marketing_touches');
});

test('buildDiagnosisIssues: repeat decline + staff risk + new customer', async () => {
  const pool = makePool(async (sql) => {
    if (/growth_ontology_data_quality/i.test(sql)) return { rows: [{ data_id: 'x' }] };
    return { rows: [] };
  });
  const stats = {
    current: { revenue: 10000, orders: 100, customers: 80 },
    prev: { revenue: 10000, orders: 100, customers: 80 },
    repeat: { repeatRate: 0.2, riskCustomers: 0, customers: 50 },
    marketing: { touched: 10, returned: 1, conversionRate: 0.1 },
    employee: { avgScore: 90, lowCount: 2 },
    dormant: { priorityCustomerCount: 0, minLastVisitDays: 100, maxVisitCount: 3, maxTotalSpend: 500 },
    newCustomerSecondVisit: { noSecondVisit: 8, avgFirstSpend: 120 },
  };
  const { issues } = await buildDiagnosisIssues(pool, {
    tenantId: 'default', storeId: 's1', date: '2026-07-26',
    rules: new Map(), thresholds: baseThresholds, stats,
  });
  const types = issues.map(i => i.issue_type);
  assert.ok(types.includes('repeat_decline'));
  assert.ok(types.includes('staff_execution_risk'));
  assert.ok(types.includes('new_customer_no_second_visit'));
  assert.ok(types.includes('marketing_ineffective'));
});

test('buildDiagnosisIssues: customer asset risk via dormant fallback', async () => {
  const pool = makePool();
  const stats = {
    current: { revenue: 10000, orders: 50, customers: 40 },
    prev: { revenue: 10000, orders: 50, customers: 40 },
    repeat: { repeatRate: 0.4, riskCustomers: 2, customers: 20 },
    marketing: { touched: 5, returned: 2, conversionRate: 0.4 },
    employee: { avgScore: 75, lowCount: 0 },
    dormant: { priorityCustomerCount: 0, minLastVisitDays: 95, maxVisitCount: 1, maxTotalSpend: 100 },
    newCustomerSecondVisit: { noSecondVisit: 0, avgFirstSpend: 0 },
  };
  const { issues } = await buildDiagnosisIssues(pool, {
    tenantId: 'default', storeId: 's1', date: '2026-07-26',
    rules: new Map(), thresholds: baseThresholds, stats,
  });
  assert.ok(issues.some(i => i.issue_type === 'customer_asset_risk'));
});

test('buildDiagnosisIssues: below peer benchmark when store has business_type', async () => {
  const pool = makePool(async (sql) => {
    if (/growth_ontology_stores/i.test(sql)) {
      return { rows: [{ business_type: 'mixed', scale: 'small', price_band: 'mid' }] };
    }
    if (/growth_ontology_benchmarks/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const stats = {
    current: { revenue: 4000, orders: 100, customers: 80 },
    prev: { revenue: 5000, orders: 100, customers: 80 },
    repeat: { repeatRate: 0.5, riskCustomers: 0, customers: 80 },
    marketing: { touched: 5, returned: 3, conversionRate: 0.6 },
    employee: { avgScore: 70, lowCount: 0 },
    dormant: { priorityCustomerCount: 0, minLastVisitDays: 90, maxVisitCount: 0, maxTotalSpend: 0 },
    newCustomerSecondVisit: { noSecondVisit: 0, avgFirstSpend: 0 },
  };
  const { issues } = await buildDiagnosisIssues(pool, {
    tenantId: 'default', storeId: 's1', date: '2026-07-26',
    rules: new Map(), thresholds: baseThresholds, stats,
  });
  assert.ok(issues.some(i => i.issue_type === 'below_peer_benchmark'));
});

test('fetchDiagnosisStats aggregates mock pool rows', async () => {
  let calls = 0;
  const pool = makePool(async () => {
    calls += 1;
    if (calls === 1) return { rows: [{ revenue: 100, orders: 5, customers: 3 }] };
    if (calls === 2) return { rows: [{ revenue: 120, orders: 6, customers: 4 }] };
    if (calls === 3) return { rows: [{ repeat_customers: 2, customers: 10, risk_customers: 1 }] };
    if (calls === 4) return { rows: [{ touched: 5, returned: 2 }] };
    if (calls === 5) return { rows: [{ avg_score: 80, low_count: 0 }] };
    if (calls === 6) return { rows: [{ dormant_count: 1, priority_customer_count: 0, max_visit_count: 2, max_total_spend: 400, avg_total_spend: 200, min_last_visit_days: 100 }] };
    if (calls === 7) return { rows: [{ candidates: 3, no_second_visit: 2, signature_dish_customers: 1, avg_first_spend: 90 }] };
    return { rows: [] };
  });
  const window = resolveDiagnosisWindow('2026-07-26');
  const stats = await fetchDiagnosisStats(pool, {
    tenantId: 'default', storeId: 's1', date: '2026-07-26', thresholds: baseThresholds, window,
  });
  assert.equal(num(stats.current.revenue), 100);
  assert.equal(num(stats.prev.revenue), 120);
  assert.ok(stats.repeat.repeatRate > 0);
  assert.equal(stats.marketing.touched, 5);
});

test('supersedeOpenDiagnosisRecords issues two updates', async () => {
  const sqls = [];
  const pool = makePool(async (sql) => {
    sqls.push(sql);
    return { rowCount: 1 };
  });
  await supersedeOpenDiagnosisRecords(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(sqls.length, 2);
  assert.match(sqls[0], /growth_ontology_issues/);
  assert.match(sqls[1], /growth_ontology_opportunities/);
});

test('persistDiagnosisIssues inserts and returns saved rows', async () => {
  const inserts = [];
  const pool = makePool(async (sql, params) => {
    if (/INSERT INTO growth_ontology_issues/i.test(sql)) {
      inserts.push(params);
      return { rows: [{ issue_id: params[0], issue_type: params[3], evidence_json: {}, confidence_score: 0.8, severity: 'P2' }] };
    }
    return { rows: [] };
  });
  const issue = issueRow({
    tenantId: 'default', storeId: 's1', issueType: 'repeat_decline', title: '复购偏弱',
    description: 'd', severity: 'P2', confidence: 0.76, evidence: {}, roots: [], impact: 0,
  });
  const { savedIssues, opportunities } = await persistDiagnosisIssues(pool, {
    tenantId: 'default', storeId: 's1', issues: [issue], rules: new Map(), thresholds: baseThresholds,
  });
  assert.equal(inserts.length, 1);
  assert.equal(savedIssues.length, 1);
  assert.ok(Array.isArray(opportunities));
});

test('orderStats returns zeros when no rows', async () => {
  const pool = makePool(async () => ({ rows: [] }));
  const r = await orderStats(pool, { tenantId: 'default', storeId: 's1', start: 'a', end: 'b' });
  assert.equal(r.revenue, 0);
  assert.equal(r.orders, 0);
});

test('repeatStats / marketingStats / employeeStats compute ratios', async () => {
  const pool = makePool(async (sql) => {
    if (/repeat_customers/i.test(sql)) {
      return { rows: [{ repeat_customers: 3, customers: 10, risk_customers: 2 }] };
    }
    if (/growth_ontology_touches/i.test(sql)) {
      return { rows: [{ touched: 4, returned: 1 }] };
    }
    if (/growth_ontology_employees/i.test(sql)) {
      return { rows: [{ avg_score: 72.5, low_count: 1 }] };
    }
    return { rows: [] };
  });
  const repeat = await repeatStats(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(repeat.repeatRate, 0.3);
  assert.equal(repeat.riskCustomers, 2);
  const marketing = await marketingStats(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(marketing.conversionRate, 0.25);
  const employee = await employeeStats(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(employee.avgScore, 72.5);
  assert.equal(employee.lowCount, 1);
});

test('dormantCustomerStats / newCustomerSecondVisitStats shape defaults', async () => {
  const pool = makePool(async (sql) => {
    if (/dormant_count/i.test(sql)) {
      return {
        rows: [{
          dormant_count: 5,
          priority_customer_count: 2,
          max_visit_count: 4,
          max_total_spend: 600,
          avg_total_spend: 200,
          min_last_visit_days: 95,
        }],
      };
    }
    if (/first_visit AS/i.test(sql)) {
      return {
        rows: [{
          candidates: 6,
          no_second_visit: 3,
          signature_dish_customers: 1,
          avg_first_spend: 88,
        }],
      };
    }
    return { rows: [] };
  });
  const dormant = await dormantCustomerStats(pool, {
    tenantId: 'default', storeId: 's1', date: '2026-07-26',
  });
  assert.equal(dormant.dormantCustomerCount, 5);
  assert.equal(dormant.daysMin, 90);
  const ncs = await newCustomerSecondVisitStats(pool, {
    tenantId: 'default', storeId: 's1', date: '2026-07-26',
  });
  assert.equal(ncs.noSecondVisit, 3);
  assert.equal(ncs.avgFirstSpend, 88);
});

test('loadDiagnosisThresholds returns defaults when pool errors', async () => {
  const pool = makePool(async () => { throw new Error('no rules'); });
  const t = await loadDiagnosisThresholds(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(t.dormantDaysMin, 90);
  assert.equal(t.newFirstVisitDaysMax, 14);
  assert.equal(t.revenueDeclineFallback, -8);
});

test('loadDiagnosisRulesSafe swallows pool errors via loadEffectiveRules', async () => {
  const pool = makePool(async () => { throw new Error('rules table missing'); });
  const state = await loadDiagnosisRulesSafe(pool, { tenantId: 'default', storeId: 's1' });
  assert.equal(state.rules.length, 0);
  assert.equal(state.byId.size, 0);
  assert.equal(state.error, undefined);
});
