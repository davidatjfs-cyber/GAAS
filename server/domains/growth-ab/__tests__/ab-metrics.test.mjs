import test from 'node:test';
import assert from 'node:assert/strict';
import {
  abMetricValue,
  evalAbMetric,
  interpolateAbContent,
  isAbManualInput,
  listAbTemplates,
  sanitizeMetricDef,
} from '../ab-metrics.js';

test('sanitizeMetricDef: rejects empty/invalid num, defaults format from den', () => {
  assert.equal(sanitizeMetricDef(null, ['sent']), null);
  assert.equal(sanitizeMetricDef({ num: [] }, ['sent']), null);
  assert.equal(sanitizeMetricDef({ num: ['unknown'] }, ['sent']), null);
  assert.equal(sanitizeMetricDef({ num: ['sent'], den: 'unknown' }, ['sent']), null);

  const withDen = sanitizeMetricDef({ key: 'rate', label: '核销率', num: ['redemptions'], den: 'sent' }, ['redemptions', 'sent']);
  assert.deepEqual(withDen, { key: 'rate', label: '核销率', num: ['redemptions'], den: 'sent', format: 'pct' });

  const withoutDen = sanitizeMetricDef({ num: ['sent'] }, ['sent']);
  assert.equal(withoutDen.den, null);
  assert.equal(withoutDen.format, 'int');
});

test('evalAbMetric: computes ratio/sum and handles zero denominator', () => {
  assert.equal(evalAbMetric({ sent: 100, redemptions: 25 }, { num: ['redemptions'], den: 'sent', format: 'pct' }), 0.25);
  assert.equal(evalAbMetric({ sent: 0, redemptions: 25 }, { num: ['redemptions'], den: 'sent', format: 'pct' }), 0);
  assert.equal(evalAbMetric({ revenue: 199.995 }, { num: ['revenue'], den: null, format: 'money' }), 200);
  assert.equal(evalAbMetric({}, null), 0);
});

test('abMetricValue: dispatches by metric name', () => {
  const v = { sent: 100, clicks: 20, revenue: 500, revenue_per_order: 25, redemption_rate: 0.3 };
  assert.equal(abMetricValue(v, 'click_rate'), 0.2);
  assert.equal(abMetricValue(v, 'response_rate'), 0.2);
  assert.equal(abMetricValue(v, 'revenue'), 500);
  assert.equal(abMetricValue(v, 'revenue_per_order'), 25);
  assert.equal(abMetricValue(v, 'redemption_rate'), 0.3);
  assert.equal(abMetricValue(v, 'unknown_metric'), 0.3);
  assert.equal(abMetricValue({ sent: 0, clicks: 5 }, 'click_rate'), 0);
});

test('interpolateAbContent: replaces name placeholders, falls back to 您', () => {
  assert.equal(interpolateAbContent('您好{姓名}，欢迎光临', { name: '张三' }), '您好张三，欢迎光临');
  assert.equal(interpolateAbContent('Hi {name}', { member_name: '李四' }), 'Hi 李四');
  assert.equal(interpolateAbContent('您好{姓名}', {}), '您好您');
});

test('isAbManualInput: true when bound to a rule or has a custom metrics schema', () => {
  assert.equal(isAbManualInput({}), false);
  assert.equal(isAbManualInput({ target_rule_key: 'rk_1' }), true);
  assert.equal(isAbManualInput({ metrics_schema: { fields: [] } }), true);
  assert.equal(isAbManualInput({ metrics_schema: null }), false);
});

test('listAbTemplates: returns the shared template list', () => {
  const templates = listAbTemplates();
  assert.ok(Array.isArray(templates));
  assert.ok(templates.some((t) => t.key === 'sms'));
});
