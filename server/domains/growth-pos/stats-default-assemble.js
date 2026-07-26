/**
 * Assemble default POS stats response — P5.4.
 */
import { fetchDineMetricsForDays, resolveStoreCanonicalName } from '../../utils/dine-metrics.js';

export async function assembleDefaultPosStats(pool, sid, days, core, detail) {
  const {
    summaryR, storeR, hourR, payR, dishR, repeatR, reportSummaryR,
  } = core;
  const {
    byOrderTypeR, byOrderSourceR, byDeptR, periodProfileR, spendDistR, visitR, dishCatR,
    custOrderTypeR, custOrderSourceR, custDeptR,
  } = detail;

const periodRow = periodProfileR.rows[0] || {};
const lcCounts = periodRow.lifecycle_json || {};
const tierCounts = periodRow.value_tier_json || {};
const everEngaged = (lcCounts.new || 0) + (lcCounts.active || 0) + (lcCounts.at_risk || 0)
  + (lcCounts.dormant || 0) + (lcCounts.churned || 0)
  + (lcCounts.lost_90 || 0) + (lcCounts.lost_180 || 0) + (lcCounts.lost_365 || 0);
const lostCount = (lcCounts.dormant || 0) + (lcCounts.churned || 0)
  + (lcCounts.lost_90 || 0) + (lcCounts.lost_180 || 0) + (lcCounts.lost_365 || 0);
const churnRate = everEngaged ? Math.round((lostCount / everEngaged) * 1000) / 10 : 0;

const recentCustomers = Number(periodRow.total_customers || 0);
const newCustomerCount = Number(periodRow.new_count || 0);
const returningCustomerCount = Number(periodRow.returning_count || 0);
const repurchasers = Number(periodRow.repurchasers || 0);
const repurchaseRate = recentCustomers ? Math.round((repurchasers / recentCustomers) * 1000) / 10 : 0;

const rawSummary = summaryR.rows[0] || {};
const reportSummary = reportSummaryR.rows[0] || {};
const reportDays = Number(reportSummary.report_days || 0);
const mergedSummary = {
  ...rawSummary,
  total_orders: reportDays > 0
    ? Number(reportSummary.report_dine_orders || 0) + Number(reportSummary.report_delivery_orders || 0)
    : rawSummary.total_orders,
  total_revenue: reportDays > 0 ? reportSummary.report_total_revenue : rawSummary.total_revenue,
  total_before_revenue: reportDays > 0 ? reportSummary.report_total_before_revenue : rawSummary.total_before_revenue,
  total_diners: reportDays > 0 ? Number(reportSummary.report_total_diners || 0) : rawSummary.total_diners,
  avg_spend_per_person: reportDays > 0 ? reportSummary.report_avg_spend_per_person : rawSummary.avg_spend_per_person,
  dine_pos_orders: Number(rawSummary.dine_pos_orders || 0),
  dine_pos_before_revenue: rawSummary.dine_pos_before_revenue || 0,
  avg_table_spend: rawSummary.avg_table_spend || 0,
  dine_orders: reportDays > 0 ? Number(reportSummary.report_dine_orders || 0) : null,
  delivery_orders: reportDays > 0 ? Number(reportSummary.report_delivery_orders || 0) : null,
  delivery_revenue: reportDays > 0 ? reportSummary.report_delivery_revenue : null,
  report_days: reportDays,
  data_source: reportDays > 0 ? 'daily_reports' : 'pos_orders',
};

const metricsStoreName = resolveStoreCanonicalName(sid);
if (metricsStoreName) {
  const dine = await fetchDineMetricsForDays(pool, metricsStoreName, days);
  mergedSummary.total_diners = dine.dine_traffic;
  mergedSummary.dine_orders = dine.dine_orders;
  mergedSummary.dine_before_revenue = dine.dine_before_revenue;
  mergedSummary.avg_table_spend = dine.avg_table_spend;
  mergedSummary.avg_spend_per_person = dine.avg_spend_per_person;
  mergedSummary.dine_data_source = dine.data_source;
  mergedSummary.data_source = dine.data_source;
}

const profileInsights = {
  lifecycle: lcCounts,
  value_tier: tierCounts,
  stats_days: days,
  churn_rate: churnRate,
  churn_detail: {
    lost: lostCount,
    ever_engaged: everEngaged,
    dormant: lcCounts.dormant || 0,
    churned: lcCounts.churned || 0,
  },
  customer_metrics: {
    total_customers: recentCustomers,
    new_count: newCustomerCount,
    returning_count: returningCustomerCount,
    active_count: Number(periodRow.active_count || 0),
    at_risk_count: Number(periodRow.at_risk_count || 0),
    dormant_count: Number(periodRow.dormant_count || 0),
    churned_count: Number(periodRow.churned_count || 0),
    vip_count: Number(periodRow.vip_count || 0),
    churn_rate: churnRate,
    repurchase_rate: repurchaseRate,
    repurchase_detail: { repurchasers, total_with_orders: recentCustomers },
  },
  avg_spend_dist: Object.fromEntries(spendDistR.rows.map((r) => [r.spend_tier, r.cnt])),
  avg_table_spend: mergedSummary.avg_table_spend,
  top_visit_times: Object.fromEntries(visitR.rows.map((r) => [r.visit_time, r.cnt])),
  top_dish_categories: Object.fromEntries(dishCatR.rows.map((r) => [r.category, r.total_qty])),
  high_value_customers: {
    count: Number(periodRow.high_value_count || 0),
    avg_spending: periodRow.vip_avg_check,
    avg_orders: periodRow.avg_orders,
  },
  new_vs_returning: {
    new_count: newCustomerCount,
    returning_count: returningCustomerCount,
    total_customers: recentCustomers,
    new_pct: recentCustomers ? Math.round((newCustomerCount / recentCustomers) * 1000) / 10 : 0,
    returning_pct: recentCustomers ? Math.round((returningCustomerCount / recentCustomers) * 1000) / 10 : 0,
  },
  cust_order_type: Object.fromEntries(custOrderTypeR.rows.map((r) => [r.order_type, r.cnt])),
  cust_order_source: Object.fromEntries(custOrderSourceR.rows.map((r) => [r.order_source, r.cnt])),
  cust_dept: Object.fromEntries(custDeptR.rows.map((r) => [r.department, r.total_qty])),
};

return {
  ok: true,
  summary: mergedSummary,
  byStore: storeR.rows,
  hourDist: hourR.rows,
  payDist: payR.rows,
  topDishes: dishR.rows,
  repeatStats: repeatR.rows[0] || {},
  profileInsights,
  byOrderType: byOrderTypeR.rows,
  byOrderSource: byOrderSourceR.rows,
  byDept: byDeptR.rows,
};
}
