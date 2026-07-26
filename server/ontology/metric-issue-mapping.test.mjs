import test from 'node:test';
import assert from 'node:assert/strict';
import { METRIC_ISSUE_MAPPINGS, listMetricIssueMappings } from './metric-issue-mapping.js';

test('METRIC_ISSUE_MAPPINGS includes core revenue and retention metrics', () => {
  const ids = new Set(METRIC_ISSUE_MAPPINGS.map((m) => m.metricId));
  for (const mid of ['revenue', 'repeat_purchase_rate', 'task_overdue_rate', 'campaign_conversion_rate']) {
    assert.ok(ids.has(mid), mid);
  }
});

test('listMetricIssueMappings appends extra rows', () => {
  const extra = [{
    metricId: 'custom_metric',
    metricName: '自定义',
    domain: 'test',
    triggerDirection: 'down',
    issueId: 'custom_issue',
    issueName: '自定义问题',
    bossLanguageTitle: '测试',
    severity: 'P2',
    evidenceTemplate: 'x',
    possibleCauses: [],
    responsibleRoles: [],
    affectedResults: [],
    resultMetrics: [],
  }];
  const list = listMetricIssueMappings(extra);
  assert.equal(list.length, METRIC_ISSUE_MAPPINGS.length + 1);
  assert.equal(list.at(-1).metricId, 'custom_metric');
});

test('each mapping has issue linkage and result metrics', () => {
  for (const row of listMetricIssueMappings()) {
    assert.ok(row.issueId);
    assert.ok(row.resultMetrics.length >= 1, row.metricId);
    assert.ok(['up', 'down'].includes(row.triggerDirection));
  }
});
