import test from 'node:test';
import assert from 'node:assert/strict';
import { lintMetrics, fetchAndLintMetrics } from './metric-lint.js';

test('lintMetrics returns empty for empty input', () => {
  assert.deepEqual(lintMetrics([]), []);
  assert.deepEqual(lintMetrics(null), []);
});

test('lintMetrics detects conflicting_definition for same name different formulas', () => {
  const rows = [
    { metric_id: 'm1', name: '营业额', data_source: 'pos', formula: 'sum(revenue)' },
    { metric_id: 'm2', name: '营业额', data_source: 'pos', formula: 'sum(sales_amount)' },
  ];
  const findings = lintMetrics(rows);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, 'conflicting_definition');
  assert.equal(findings[0].name, '营业额');
  assert.deepEqual(findings[0].metric_ids, ['m1', 'm2']);
});

test('lintMetrics detects redundant_registration for duplicate formula same name', () => {
  const rows = [
    { metric_id: 'm1', name: '客单价', data_source: 'pos', formula: 'avg(ticket)' },
    { metric_id: 'm2', name: '客单价', data_source: 'pos', formula: 'avg(ticket)' },
  ];
  const findings = lintMetrics(rows);
  assert.ok(findings.some((f) => f.type === 'redundant_registration'));
});

test('lintMetrics detects duplicate_formula_different_name', () => {
  const rows = [
    { metric_id: 'm1', name: '复购率', data_source: 'crm', formula: 'rate()' },
    { metric_id: 'm2', name: '回头客比例', data_source: 'crm', formula: 'rate()' },
  ];
  const findings = lintMetrics(rows);
  assert.ok(findings.some((f) => f.type === 'duplicate_formula_different_name'));
});

test('fetchAndLintMetrics delegates to getAllMetricDefs', async () => {
  const rows = [{ metric_id: 'x', name: '唯一', data_source: 'pos', formula: '1' }];
  const findings = await fetchAndLintMetrics(async () => rows);
  assert.deepEqual(findings, []);
});
