import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCategories,
  buildCustomerSection,
  buildDiagnosisSummary,
  buildRevenueContributions,
  buildRevenueMetrics,
  buildStaffingSection,
  buildTrainingSection,
  contributionItem,
  getAnomalyDescription,
  groupAnomalyRows,
  mapAnomalyType,
  normalizeReportCategories,
  resolveBrandKey,
  sortContributions,
  supplementAnomalies,
} from '../diagnosis-helpers.js';

test('normalizeReportCategories: array/object/string inputs', () => {
  assert.deepEqual(normalizeReportCategories([{ key: 'water', amt: 100, qty: 2 }]), [
    { key: 'water', name: '水吧', amt: 100, qty: 2 },
  ]);
  assert.deepEqual(normalizeReportCategories({ wok: { amt: 50, qty: 1 } }), [
    { key: 'wok', name: '炒锅', amt: 50, qty: 1 },
  ]);
  assert.deepEqual(normalizeReportCategories('not-json'), []);
});

test('contributionItem + sortContributions', () => {
  const list = [
    contributionItem('小', 1, '%', 'd1', 'down'),
    contributionItem('大', 10, '%', 'd2', 'up'),
  ];
  sortContributions(list);
  assert.equal(list[0].factor, '大');
});

test('mapAnomalyType / getAnomalyDescription fallbacks', () => {
  assert.equal(mapAnomalyType('bad_review_service'), '服务差评');
  assert.equal(mapAnomalyType('unknown_key'), 'unknown_key');
  assert.match(getAnomalyDescription('recharge_zero'), /充值/);
});

test('resolveBrandKey', () => {
  assert.equal(resolveBrandKey('马己仙久光'), '马己仙');
  assert.equal(resolveBrandKey('洪潮店'), '洪潮');
  assert.equal(resolveBrandKey('其他'), '其他');
});

test('buildRevenueMetrics + buildRevenueContributions', () => {
  const reportRows = [
    { actual_revenue: 1000, pre_discount_revenue: 1100, delivery_actual: 100, efficiency: 500, dine_traffic: 50, dine_orders: 40, dianping_rating: 4.0, bad_reviews_dianping: 1 },
    { actual_revenue: 900, pre_discount_revenue: 950, delivery_actual: 80, efficiency: 450, dine_traffic: 45, dine_orders: 38, dianping_rating: 3.8, bad_reviews_dianping: 0 },
  ];
  const prevReportRows = [
    { actual_revenue: 1200, pre_discount_revenue: 1300, delivery_actual: 50, efficiency: 600, dine_traffic: 60, dine_orders: 50, dianping_rating: 4.5, bad_reviews_dianping: 0 },
  ];
  const dineMetrics = { dine_traffic: 95, dine_orders: 78, avg_spend_per_person: 120, avg_table_spend: 200, report_days: 2, dine_before_revenue: 1800, data_source: 'daily_reports' };
  const prevDineMetrics = { dine_traffic: 60, dine_orders: 50, avg_spend_per_person: 130, avg_table_spend: 220, report_days: 1, dine_before_revenue: 1200, data_source: 'daily_reports' };

  const built = buildRevenueMetrics({ reportRows, prevReportRows, dineMetrics, prevDineMetrics });
  assert.ok(built);
  assert.equal(built.revenue.change_pct, Number(((1900 - 1200) / 1200 * 100).toFixed(1)));
  assert.equal(built.revenue.is_decline, false);

  const contrib = buildRevenueContributions({
    metrics: built.metrics,
    reportRows,
    prevReportRows,
    tableVisitCurrent: { total_visits: 10, issue_count: 3, latest_issue_date: '2026-07-20' },
    tableVisitPrev: { total_visits: 8, issue_count: 1 },
    topDissatisfiedDish: { dish: '烧鸭' },
    memberRevenueCurrent: { member_rev: 300, total_rev: 1900 },
    memberRevenuePrev: { member_rev: 200, total_rev: 1200 },
  });
  assert.ok(contrib.contributions.length >= 1);
  assert.equal(contrib.tableVisit.current_issue_count, 3);
});

test('buildCustomerSection flags low new ratio', () => {
  const { customer, contributions } = buildCustomerSection({
    dineTraffic: 0,
    customerMetrics: { new_customers: 2, returning_customers: 18, total_customers: 20, new_pct: 10, returning_pct: 90 },
    prevCustomerMetrics: { total_customers: 0 },
    customerAnalysisRows: [],
    existingContributions: [],
  });
  assert.equal(customer.new_ratio, 10);
  assert.ok(contributions.some(c => c.factor === '新客占比低'));
});

test('groupAnomalyRows + supplementAnomalies', () => {
  const grouped = groupAnomalyRows([
    {
      anomaly_key: 'bad_review_service',
      severity: 'high',
      status: 'open',
      trigger_date: '2026-07-20',
      trigger_value: JSON.stringify({ detail: '服务慢' }),
      threshold_value: null,
      assigned_role: 'front',
    },
  ]);
  assert.equal(grouped[0].type, '服务差评');
  assert.equal(grouped[0].detail, '服务慢');

  const supplemented = supplementAnomalies({
    anomalies: [],
    revenue: { rating_change_pct: -5, table_visit: { current_issue_count: 2, prev_issue_count: 1, current_total: 10, prev_total: 8, latest_issue_date: '2026-07-21' } },
    reportRows: [{ date: '2026-07-21', dianping_rating: 3.5 }],
    endDate: '2026-07-25',
  });
  assert.equal(supplemented.length, 2);
  assert.ok(supplemented.some(a => a.key === 'bad_review_service'));
  assert.ok(supplemented.some(a => a.key === 'table_visit_product'));
});

test('buildStaffingSection detects night shift understaffing', () => {
  const staffing = buildStaffingSection({
    reportRows: [{
      date: '2026-07-25',
      staff: { front: [{ name: 'A', user: 'a1', days: 5 }], kitchen: [{ name: 'B', user: 'b1', days: 5 }] },
      segments: { noon: 100, afternoon: 100, night: 400 },
    }],
    revenue: { is_decline: true, efficiency_change_pct: -12 },
  });
  assert.equal(staffing.front_count, 1);
  assert.ok(staffing.issues.some(i => i.includes('晚班')));
});

test('buildTrainingSection + aggregateCategories + buildDiagnosisSummary', () => {
  const training = buildTrainingSection({
    trainingRows: [{ employee_username: 'u1', topic_id: 1, assignment_status: 'assigned', topic_title: 'SOP', cert_status: 'valid' }],
    employeeRows: [{ username: 'u2', name: '新员工', position: '服务员', join_date: '2026-07-01' }],
    endDate: '2026-07-25',
  });
  assert.equal(training.total_assignments, 1);
  assert.equal(training.employees_without_training.length, 1);

  const categories = aggregateCategories([
    { categories: [{ key: 'water', name: '水吧', amt: 200, qty: 4 }] },
    { categories: [{ key: 'water', name: '水吧', amt: 100, qty: 2 }] },
  ], 1000);
  assert.equal(categories[0].share_pct, 30);

  const summary = buildDiagnosisSummary({
    revenue: { is_decline: true, change_pct: -8, contributions: [contributionItem('客流量下降', 10, '%', 'd', 'down')] },
    customer: { new_ratio: 15 },
    anomalies: [{ severity: 'high', type: '服务差评' }],
    staffing: { issues: ['晚班不足'] },
    recommendations: [{ title: 'r1' }],
    action_suggestions: [{ title: 'a1' }],
  });
  assert.match(summary.headline, /营业额下降8%/);
  assert.equal(summary.recommendation_count, 1);
});
