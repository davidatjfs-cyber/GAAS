import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METRIC_NAMES,
  recordMetric,
  getMetricsSnapshot,
  resetMetrics,
} from '../domains/shared/metrics.js';

test('recordMetric: counter increments with tags', () => {
  resetMetrics();
  recordMetric(METRIC_NAMES.HRMS_STATE_DUAL_WRITE_FAILURE, {
    value: 1,
    tags: { scope: 'leave_records' },
  });
  recordMetric(METRIC_NAMES.HRMS_STATE_DUAL_WRITE_FAILURE, {
    value: 1,
    tags: { scope: 'leave_records' },
  });
  const snap = getMetricsSnapshot();
  assert.equal(
    snap.counters['hrms_state.dual_write.failure{scope=leave_records}'],
    2
  );
});

test('recordMetric: duration_ms tracked as histogram', () => {
  resetMetrics();
  recordMetric(METRIC_NAMES.APPROVAL_DECIDE_DURATION_MS, {
    value: 100,
    tags: { status: 'approved' },
  });
  recordMetric(METRIC_NAMES.APPROVAL_DECIDE_DURATION_MS, {
    value: 200,
    tags: { status: 'approved' },
  });
  const snap = getMetricsSnapshot();
  const h = snap.histograms['approval.decide.duration_ms{status=approved}'];
  assert.equal(h.count, 2);
  assert.equal(h.sum, 300);
  assert.equal(h.min, 100);
  assert.equal(h.max, 200);
  assert.equal(h.avg, 150);
});

test('recordMetric: ignores invalid name/value', () => {
  resetMetrics();
  recordMetric('', { value: 1 });
  recordMetric('foo', { value: NaN });
  assert.deepEqual(getMetricsSnapshot(), { counters: {}, histograms: {} });
});

test('resetMetrics clears state', () => {
  recordMetric(METRIC_NAMES.LLM_CALL_SUCCESS, { value: 1 });
  resetMetrics();
  assert.deepEqual(getMetricsSnapshot(), { counters: {}, histograms: {} });
});
