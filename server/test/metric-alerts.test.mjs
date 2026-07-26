import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMetricAlerts,
  getMetricAlerts,
  setMetricAlerts,
} from '../domains/shared/metric-alerts.js';

test('onApprovalDecide: below threshold does not alert', async () => {
  const calls = [];
  const alerts = createMetricAlerts({
    sendAdminSystemAlert: async (msg, opts) => {
      calls.push({ msg, opts });
    },
    slowApproveMs: 5000,
  });
  alerts.onApprovalDecide(100, { id: 1, type: 'leave', status: 'approved' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 0);
});

test('onApprovalDecide: slow path fires Feishu alert', async () => {
  const calls = [];
  const alerts = createMetricAlerts({
    sendAdminSystemAlert: async (msg, opts) => {
      calls.push({ msg, opts });
    },
    slowApproveMs: 100,
  });
  alerts.onApprovalDecide(250, { id: 9, type: 'leave', status: 'approved' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1);
  assert.match(calls[0].msg, /审批耗时告警/);
  assert.equal(calls[0].opts.persistToHrms, false);
  assert.equal(calls[0].opts.meta.kind, 'approval_slow');
});

test('onLlmFailure: fires Feishu alert', async () => {
  const calls = [];
  const alerts = createMetricAlerts({
    sendAdminSystemAlert: async (msg, opts) => {
      calls.push({ msg, opts });
    },
  });
  alerts.onLlmFailure({ provider: 'ark', reason: 'unreachable', durationMs: 12 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls.length, 1);
  assert.match(calls[0].msg, /LLM 调用失败/);
  assert.equal(calls[0].opts.meta.kind, 'llm_failure');
});

test('setMetricAlerts / getMetricAlerts round-trip', () => {
  const custom = createMetricAlerts({});
  setMetricAlerts(custom);
  assert.equal(getMetricAlerts(), custom);
});
