import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterStaleHeartbeats,
  formatStaleHeartbeatDeadLabel,
  staleHeartbeatDedupeKey,
  DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN,
} from '../domains/health/scheduler-heartbeat.js';

test('filterStaleHeartbeats：低于阈值放过；达到阈值命中', () => {
  const rows = [
    { task_name: 'cache_purge', minutes_ago: 100 },
    { task_name: 'cache_purge', minutes_ago: 400 },
    { task_name: 'pos_sales_check', minutes_ago: 72 * 60 },
    { task_name: 'unknown_task', minutes_ago: 200 },
    { task_name: '', minutes_ago: 999 },
  ];
  const stale = filterStaleHeartbeats(rows);
  assert.deepEqual(
    stale.map((r) => r.task_name),
    ['cache_purge', 'pos_sales_check', 'unknown_task']
  );
  assert.equal(DEFAULT_HEARTBEAT_ALERT_THRESHOLDS_MIN.cache_purge, 390);
});

test('format + dedupe key', () => {
  const stale = [
    { task_name: 'a', minutes_ago: 65 },
    { task_name: 'b', minutes_ago: 90 },
  ];
  assert.match(formatStaleHeartbeatDeadLabel(stale), /a（65分钟前）/);
  assert.equal(staleHeartbeatDedupeKey(stale), 'a:2|b:3');
});
