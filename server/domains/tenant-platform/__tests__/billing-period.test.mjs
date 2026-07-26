/**
 * L1：账单账期换算 — monthly/quarterly/yearly/非法日期。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBillingPeriod } from '../billing-period.js';

test('computeBillingPeriod: 非法日期 → null', () => {
  assert.equal(computeBillingPeriod(null, 'monthly'), null);
  assert.equal(computeBillingPeriod('not-a-date', 'monthly'), null);
});

test('computeBillingPeriod: monthly 默认往前一个月', () => {
  const r = computeBillingPeriod('2026-07-15T00:00:00.000Z', 'monthly');
  assert.ok(r);
  assert.equal(r.end.toISOString(), '2026-07-15T00:00:00.000Z');
  assert.equal(r.start.toISOString(), '2026-06-15T00:00:00.000Z');
});

test('computeBillingPeriod: quarterly / yearly', () => {
  const q = computeBillingPeriod('2026-07-01T00:00:00.000Z', 'quarterly');
  assert.equal(q.start.toISOString(), '2026-04-01T00:00:00.000Z');
  const y = computeBillingPeriod('2026-07-01T00:00:00.000Z', 'yearly');
  assert.equal(y.start.toISOString(), '2025-07-01T00:00:00.000Z');
});

test('computeBillingPeriod: 未知 cycle 按 monthly', () => {
  const r = computeBillingPeriod('2026-03-15T00:00:00.000Z', undefined);
  assert.equal(r.start.toISOString(), '2026-02-15T00:00:00.000Z');
});
