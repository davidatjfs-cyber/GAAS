import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_RESULT_MAPPINGS, listActionResultMappings } from './action-result-mapping.js';

test('ACTION_RESULT_MAPPINGS covers core action types', () => {
  const types = new Set(ACTION_RESULT_MAPPINGS.map((m) => m.actionType));
  for (const t of ['customer_reactivation', 'operation_diagnosis', 'task_closure', 'marketing_attribution']) {
    assert.ok(types.has(t), `missing ${t}`);
  }
});

test('listActionResultMappings returns defensive copies', () => {
  const list = listActionResultMappings();
  assert.equal(list.length, ACTION_RESULT_MAPPINGS.length);
  list[0].trackingMetrics.push('mutated');
  const again = listActionResultMappings();
  assert.ok(!again[0].trackingMetrics.includes('mutated'));
});

test('each mapping has non-empty trackingMetrics', () => {
  for (const item of listActionResultMappings()) {
    assert.ok(item.trackingMetrics.length >= 1, item.actionType);
  }
});
