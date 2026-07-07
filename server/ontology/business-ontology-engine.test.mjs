import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichReportWithOntology,
  generateActionPlanFromInsights,
  generateBossSummary,
  getBusinessDomains,
  inferIssuesFromMetrics,
} from './business-ontology-engine.js';
import { createTaskDraftsFromOntologyInsights } from './task-draft-adapter.js';

test('repeat_purchase_rate down infers customer_retention_weak', () => {
  const insights = inferIssuesFromMetrics({
    repeat_purchase_rate: { current: 18, previous: 25, changeRate: -28 },
  });
  assert.equal(insights[0].issueId, 'customer_retention_weak');
  assert.equal(insights[0].bossLanguageTitle, '进得来，留不住');
  assert.ok(insights[0].responsibleRoles.includes('店长'));
});

test('vip_inactive_count up infers vip_churn_risk', () => {
  const insights = inferIssuesFromMetrics({
    vip_inactive_count: { current: 38, previous: 21, changeRate: 80 },
  });
  assert.equal(insights[0].issueId, 'vip_churn_risk');
  assert.ok(insights[0].trackingMetrics.includes('VIP回店人数'));
});

test('lunch_revenue down infers lunch_business_weak', () => {
  const insights = inferIssuesFromMetrics({
    lunch_revenue: { current: 7200, previous: 9800 },
  });
  assert.equal(insights[0].issueId, 'lunch_business_weak');
});

test('service_complaint_rate up infers service_quality_issue', () => {
  const insights = inferIssuesFromMetrics({
    service_complaint_rate: { current: 9, previous: 4 },
  });
  assert.equal(insights[0].issueId, 'service_quality_issue');
});

test('training_completion_rate down infers training_execution_weak', () => {
  const insights = inferIssuesFromMetrics({
    training_completion_rate: { current: 61, previous: 82 },
  });
  assert.equal(insights[0].issueId, 'training_execution_weak');
});

test('task_overdue_rate up infers task_closure_weak', () => {
  const insights = inferIssuesFromMetrics({
    task_overdue_rate: { current: 22, previous: 11 },
  });
  assert.equal(insights[0].issueId, 'task_closure_weak');
});

test('multiple metrics for the same issue merge evidence without duplicate issue', () => {
  const insights = inferIssuesFromMetrics({
    repeat_purchase_rate: { current: 18, previous: 25, changeRate: -28 },
    repeat_purchase_rate_alias: { current: 16, previous: 21, changeRate: -24 },
  }, {
    extraMetricIssueMappings: [{
      metricId: 'repeat_purchase_rate_alias',
      metricName: '复购率',
      domain: 'customer_growth',
      triggerDirection: 'down',
      issueId: 'customer_retention_weak',
      issueName: '老客维护不足',
      bossLanguageTitle: '进得来，留不住',
      severity: 'P2',
      evidenceTemplate: '复购率从 {previous}% 下降到 {current}%，变化 {changeRate}%',
      possibleCauses: ['老客维护没有持续跟进'],
      responsibleRoles: ['店长'],
      affectedResults: ['营业额'],
      resultMetrics: ['回店人数'],
    }],
  });
  assert.equal(insights.length, 1);
  assert.equal(insights[0].evidence.length, 2);
});

test('generateActionPlanFromInsights includes owner role, deadline, expected result, and tracking metrics', () => {
  const insights = inferIssuesFromMetrics({
    vip_inactive_count: { current: 38, previous: 21, changeRate: 80 },
  });
  const actionPlan = generateActionPlanFromInsights(insights);
  assert.ok(actionPlan.length >= 1);
  assert.ok(actionPlan[0].ownerRole);
  assert.ok(actionPlan[0].deadlineDays > 0);
  assert.ok(actionPlan[0].expectedResult);
  assert.ok(actionPlan[0].trackingMetrics.length > 0);
  assert.equal(actionPlan[0].relatedIssueId, 'vip_churn_risk');
});

test('generateBossSummary returns boss language instead of a metric-only restatement', () => {
  const insights = inferIssuesFromMetrics({
    repeat_purchase_rate: { current: 18, previous: 25, changeRate: -28 },
  });
  const summary = generateBossSummary(insights);
  assert.match(summary, /最大问题|优先/);
  assert.match(summary, /建议/);
  assert.doesNotMatch(summary, /ontology|metric|指标ID/i);
});

test('task-draft-adapter creates drafts without writing database records', () => {
  const insights = inferIssuesFromMetrics({
    task_overdue_rate: { current: 22, previous: 11 },
  });
  const drafts = createTaskDraftsFromOntologyInsights(insights, { now: new Date('2026-07-07T00:00:00Z') });
  assert.ok(drafts.length >= 1);
  assert.equal(drafts[0].status, 'draft');
  assert.equal(drafts[0].sourceIssueId, 'task_closure_weak');
  assert.ok(drafts[0].dueDate);
});

test('enrichReportWithOntology appends insights, boss summary, action plan, and priority issues', () => {
  const report = enrichReportWithOntology({ title: '经营诊断' }, {
    service_complaint_rate: { current: 9, previous: 4 },
  });
  assert.equal(report.title, '经营诊断');
  assert.equal(report.ontologyInsights[0].issueId, 'service_quality_issue');
  assert.ok(report.bossSummary);
  assert.ok(report.actionPlan.length > 0);
  assert.ok(report.priorityIssues.length > 0);
});

test('getBusinessDomains returns four business domains', () => {
  assert.equal(getBusinessDomains().length, 4);
});
