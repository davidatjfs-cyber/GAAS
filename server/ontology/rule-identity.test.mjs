import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listRuleIdentities,
  resolveRuleIdentity,
  getDefaultThreshold,
  stampInsightIdentity,
} from './rule-identity.js';

test('listRuleIdentities returns defensive copies', () => {
  const list = listRuleIdentities();
  assert.ok(list.length >= 8);
  list[0].reportIssueIds.push('mutated');
  const again = listRuleIdentities();
  assert.ok(!again[0].reportIssueIds.includes('mutated'));
});

test('resolveRuleIdentity by reportIssueId', () => {
  const row = resolveRuleIdentity({ reportIssueId: 'customer_retention_weak' });
  assert.equal(row.canonicalIssueId, 'repeat_decline');
  assert.equal(row.ruleId, 'repeat_rate_low');
});

test('resolveRuleIdentity by diagnosisIssueType and ruleId', () => {
  assert.equal(resolveRuleIdentity({ diagnosisIssueType: 'revenue_decline' }).canonicalIssueId, 'revenue_decline');
  assert.equal(resolveRuleIdentity({ ruleId: 'task_overdue_high' }).canonicalIssueId, 'staff_execution_risk');
});

test('resolveRuleIdentity by metricId', () => {
  const row = resolveRuleIdentity({ metricId: 'repeat_purchase_rate' });
  assert.equal(row.canonicalIssueId, 'repeat_decline');
});

test('resolveRuleIdentity returns null for unknown ref', () => {
  assert.equal(resolveRuleIdentity({ reportIssueId: 'unknown_issue_xyz' }), null);
});

test('getDefaultThreshold returns catalog value or fallback', () => {
  assert.equal(getDefaultThreshold('repeat_rate_low', 'rate_threshold', 0.5), 0.35);
  assert.equal(getDefaultThreshold('unknown_rule', 'rate_threshold', 0.5), 0.5);
});

test('stampInsightIdentity stamps canonical fields when matched', () => {
  const stamped = stampInsightIdentity({
    issueId: 'customer_retention_weak',
    sourceMetrics: ['repeat_purchase_rate'],
    title: '复购弱',
  });
  assert.equal(stamped.canonicalIssueId, 'repeat_decline');
  assert.equal(stamped.diagnosisIssueType, 'repeat_decline');
  assert.equal(stamped.ruleId, 'repeat_rate_low');
  assert.equal(stamped.title, '复购弱');
});

test('stampInsightIdentity keeps issueId when unmatched', () => {
  const stamped = stampInsightIdentity({ issueId: 'custom_issue' });
  assert.equal(stamped.canonicalIssueId, 'custom_issue');
  assert.equal(stamped.diagnosisIssueType, null);
  assert.equal(stamped.ruleId, null);
});
