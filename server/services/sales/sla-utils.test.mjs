import test from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessDays, computeDueAt } from './sla-utils.js';

test('addBusinessDays skips weekends', () => {
  // 2026-07-24 is Friday
  const fri = new Date('2026-07-24T12:00:00+08:00');
  const due = addBusinessDays(fri, 1);
  assert.equal(due.getDay(), 1); // Monday
  assert.equal(due.toISOString().slice(0, 10), '2026-07-27');
});

test('addBusinessDays counts multiple business days', () => {
  const mon = new Date('2026-07-27T12:00:00+08:00');
  const due = addBusinessDays(mon, 3);
  assert.equal(due.toISOString().slice(0, 10), '2026-07-30'); // Thu
});

test('computeDueAt: business_day uses addBusinessDays', () => {
  const from = new Date('2026-07-24T12:00:00+08:00');
  const due = computeDueAt(from, { unit: 'business_day', amount: 1 });
  assert.equal(due.toISOString().slice(0, 10), '2026-07-27');
});

test('computeDueAt: calendar days add amount directly', () => {
  const from = new Date('2026-07-24T12:00:00+08:00');
  const due = computeDueAt(from, { unit: 'day', amount: 7 });
  assert.equal(due.toISOString().slice(0, 10), '2026-07-31');
});
