import test from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_ACTION_MAPPINGS, listIssueActionMappings } from './issue-action-mapping.js';

test('ISSUE_ACTION_MAPPINGS includes revenue_decline actions', () => {
  const row = ISSUE_ACTION_MAPPINGS.find((m) => m.issueId === 'revenue_decline');
  assert.ok(row);
  assert.ok(row.actions.length >= 2);
  assert.ok(row.actions.every((a) => a.actionId && a.actionType));
});

test('listIssueActionMappings deep-copies actions arrays', () => {
  const list = listIssueActionMappings();
  assert.equal(list.length, ISSUE_ACTION_MAPPINGS.length);
  list[0].actions[0].executionSteps.push('mutated');
  const again = listIssueActionMappings();
  assert.ok(!again[0].actions[0].executionSteps.includes('mutated'));
});

test('every issue has at least one action with tracking metrics', () => {
  for (const item of listIssueActionMappings()) {
    assert.ok(item.actions.length >= 1, item.issueId);
    for (const action of item.actions) {
      assert.ok(action.trackingMetrics.length >= 1, `${item.issueId}/${action.actionId}`);
    }
  }
});
