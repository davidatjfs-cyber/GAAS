import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultThreshold,
  listRuleIdentities,
  resolveRuleIdentity,
  stampInsightIdentity,
} from './rule-identity.js';
import { inferIssuesFromMetrics } from './business-ontology-engine.js';

test('rule identity bridges report issueId to diagnosis issue_type', () => {
  const row = resolveRuleIdentity({ reportIssueId: 'customer_retention_weak' });
  assert.equal(row.canonicalIssueId, 'repeat_decline');
  assert.equal(row.diagnosisIssueType, 'repeat_decline');
  assert.equal(row.ruleId, 'repeat_rate_low');
});

test('default thresholds are shared for diagnosis fallbacks', () => {
  assert.equal(getDefaultThreshold('revenue_decline', 'revenueChangeRate', null), -8);
  assert.equal(getDefaultThreshold('repeat_rate_low', 'repeatRate', null), 0.35);
  assert.equal(getDefaultThreshold('marketing_conversion_low', 'marketingConversionRate', null), 0.25);
});

test('inferIssuesFromMetrics stamps canonical identity', () => {
  const insights = inferIssuesFromMetrics({
    repeat_purchase_rate: { current: 18, previous: 25, changeRate: -28 },
  });
  assert.equal(insights.length, 1);
  assert.equal(insights[0].issueId, 'customer_retention_weak');
  assert.equal(insights[0].canonicalIssueId, 'repeat_decline');
  assert.equal(insights[0].diagnosisIssueType, 'repeat_decline');
  assert.equal(insights[0].ruleId, 'repeat_rate_low');
});

test('listRuleIdentities exposes catalog', () => {
  const list = listRuleIdentities();
  assert.ok(list.some((r) => r.canonicalIssueId === 'marketing_ineffective'));
  const stamped = stampInsightIdentity({ issueId: 'marketing_conversion_weak', sourceMetrics: ['campaign_conversion_rate'] });
  assert.equal(stamped.diagnosisIssueType, 'marketing_ineffective');
});
