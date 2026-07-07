import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCustomerAssetMetricsInput,
  buildOperationImprovementMetricsInput,
  buildTalentDevelopmentMetricsInput,
  enrichReportForBusinessOntology,
} from './report-metrics-adapters.js';

test('customer asset reportData builds metricsInput from real current and previous fields', () => {
  const metrics = buildCustomerAssetMetricsInput({
    summary: { repeat_customers: 18, identifiable_customers: 100, vip_inactive_count: 12 },
    previous_period: { repeat_customers: 30, identifiable_customers: 100, vip_inactive_count: 6 },
  });
  assert.equal(metrics.repeat_purchase_rate.current, 18);
  assert.equal(metrics.repeat_purchase_rate.previous, 30);
  assert.equal(metrics.repeat_purchase_rate.changeRate, -40);
  assert.equal(metrics.vip_inactive_count.current, 12);
});

test('operation rectification reportData builds metricsInput from summary fields', () => {
  const metrics = buildOperationImprovementMetricsInput({
    summary: {
      revenue: 8000,
      previous_revenue: 10000,
      service_complaint_rate: 0.08,
      previous_service_complaint_rate: 0.04,
      completion_rate: 0.62,
      previous_completion_rate: 0.75,
      overdue_tasks: 5,
      previous_overdue_tasks: 2,
      generated_tasks: 20,
      previous_generated_tasks: 20,
    },
  });
  assert.equal(metrics.revenue.changeRate, -20);
  assert.equal(metrics.service_complaint_rate.current, 8);
  assert.equal(metrics.task_completion_rate.current, 62);
  assert.equal(metrics.task_overdue_rate.current, 25);
});

test('talent development reportData builds metricsInput from real training fields', () => {
  const metrics = buildTalentDevelopmentMetricsInput({
    summary: {
      completion_rate: 0.6,
      previous_completion_rate: 0.8,
      exam_pass_rate: 0.72,
      previous_exam_pass_rate: 0.9,
      promotion_candidates: 2,
      previous_promotion_candidates: 5,
    },
  });
  assert.equal(metrics.training_completion_rate.current, 60);
  assert.equal(metrics.certification_pass_rate.current, 72);
  assert.equal(metrics.promotion_candidate_count.changeRate, -60);
});

test('missing previous data does not fabricate changeRate', () => {
  const metrics = buildOperationImprovementMetricsInput({
    summary: { revenue: 8000 },
  });
  assert.equal(metrics.revenue, undefined);
});

test('enrichReportForBusinessOntology returns ontology fields and task drafts', () => {
  const report = enrichReportForBusinessOntology({
    summary: { repeat_customers: 18, identifiable_customers: 100 },
    previous_period: { repeat_customers: 30, identifiable_customers: 100 },
  }, buildCustomerAssetMetricsInput);
  assert.equal(report.ontologyStatus, 'ok');
  assert.ok(report.bossSummary);
  assert.ok(report.ontologyInsights.length > 0);
  assert.ok(report.actionPlan.length > 0);
  assert.ok(report.taskDrafts.length > 0);
});

test('insufficient data returns a display-safe status', () => {
  const report = enrichReportForBusinessOntology({ summary: { revenue: 8000 } }, buildOperationImprovementMetricsInput);
  assert.equal(report.ontologyStatus, 'insufficient_data');
  assert.equal(report.bossSummary, '当前数据不足，暂无法生成经营判断。');
  assert.deepEqual(report.ontologyInsights, []);
});
