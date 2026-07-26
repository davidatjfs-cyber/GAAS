/**
 * domains/growth-stored-value/helpers.js buildRemindTargetsQuery 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRemindTargetsQuery } from '../helpers.js';

test('buildRemindTargetsQuery：参数与 dormant 窗口嵌入 SQL', () => {
  const q = buildRemindTargetsQuery('store_a', 30, 10000, 14, 500);
  assert.ok(q.sql.includes('CURRENT_DATE - 30'));
  assert.ok(q.sql.includes('LIMIT 500'));
  assert.deepEqual(q.params, ['14', 'store_a', 10000]);
});
