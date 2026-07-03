import test from 'node:test';
import assert from 'node:assert/strict';

import { lintMetrics } from './metric-lint.js';

test('flags conflicting_definition when same name has different formula/source', () => {
  const rows = [
    { metric_id: 'OP_001', name: '实收营业额', data_source: 'sales_raw', formula: 'SUM(revenue)' },
    { metric_id: 'revenue', name: '实收营业额', data_source: 'daily_reports', formula: 'SUM(actual_revenue)' },
  ];
  const findings = lintMetrics(rows);
  const conflict = findings.find(f => f.type === 'conflicting_definition' && f.name === '实收营业额');
  assert.ok(conflict, 'expected a conflicting_definition finding for 实收营业额');
  assert.deepEqual(conflict.metric_ids.sort(), ['OP_001', 'revenue']);
});

test('flags redundant_registration when formula+source are identical under same name', () => {
  const rows = [
    { metric_id: 'traffic', name: '堂食客流', data_source: 'daily_reports', formula: 'SUM(dine_traffic)' },
    { metric_id: 'DR_010', name: '堂食客流', data_source: 'daily_reports', formula: 'SUM(dine_traffic)' },
  ];
  const findings = lintMetrics(rows);
  const dup = findings.find(f => f.type === 'redundant_registration');
  assert.ok(dup, 'expected a redundant_registration finding');
  assert.deepEqual(dup.metric_ids.sort(), ['DR_010', 'traffic']);
});

test('flags duplicate_formula_different_name when identical formula labeled as different concepts', () => {
  const rows = [
    { metric_id: 'orders', name: '堂食订单数', data_source: 'daily_reports', formula: 'SUM(dine_orders)' },
    { metric_id: 'DR_001', name: '堂食桌数', data_source: 'daily_reports', formula: 'SUM(dine_orders)' },
  ];
  const findings = lintMetrics(rows);
  const dup = findings.find(f => f.type === 'duplicate_formula_different_name');
  assert.ok(dup, 'expected a duplicate_formula_different_name finding');
  assert.deepEqual(dup.names.sort(), ['堂食桌数', '堂食订单数']);
});

test('no findings when all metrics are distinct', () => {
  const rows = [
    { metric_id: 'OP_001', name: '实收营业额', data_source: 'sales_raw', formula: 'SUM(revenue)' },
    { metric_id: 'HR_001', name: '在岗人数', data_source: 'schedules', formula: 'COUNT(DISTINCT employee_username)' },
  ];
  assert.deepEqual(lintMetrics(rows), []);
});

test('handles empty/undefined input without throwing', () => {
  assert.deepEqual(lintMetrics([]), []);
  assert.deepEqual(lintMetrics(undefined), []);
});
