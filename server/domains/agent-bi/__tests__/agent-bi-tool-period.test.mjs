import test from 'node:test';
import assert from 'node:assert/strict';
import { clampInt, resolveToolPeriod } from '../bi-tool-period.js';

const FIXED = new Date(2026, 6, 26); // 2026-07-26 Sunday

test('clampInt clamps / falls back', () => {
  assert.equal(clampInt(5, 1, 10, 3), 5);
  assert.equal(clampInt(0, 1, 10, 3), 1);
  assert.equal(clampInt(99, 1, 10, 3), 10);
  assert.equal(clampInt('x', 1, 10, 3), 3);
  assert.equal(clampInt(3.9, 1, 10, 0), 3);
  assert.equal(clampInt(NaN, 1, 10, 7), 7);
});

test('resolveToolPeriod: semantic today / yesterday', () => {
  const today = resolveToolPeriod({ period: 'today' }, 30, '', FIXED);
  assert.equal(today.label, '今日');
  assert.equal(today.start, '2026-07-26');
  assert.equal(today.end, '2026-07-26');
  assert.equal(today.days, 1);

  const y = resolveToolPeriod({}, 30, '昨天营收', FIXED);
  assert.equal(y.label, '昨日');
  assert.equal(y.start, '2026-07-25');
  assert.equal(y.end, '2026-07-25');
});

test('resolveToolPeriod: this_week / last_week', () => {
  // FIXED is Sunday → dow=0 → treated as 7
  const thisWeek = resolveToolPeriod({ period: 'this_week' }, 30, '', FIXED);
  assert.equal(thisWeek.label, '本周');
  assert.equal(thisWeek.start, '2026-07-20'); // Monday
  assert.equal(thisWeek.end, '2026-07-26');
  assert.equal(thisWeek.days, 7);

  const lastWeek = resolveToolPeriod({}, 30, '上周销售', FIXED);
  assert.equal(lastWeek.label, '上周');
  assert.equal(lastWeek.start, '2026-07-13');
  assert.equal(lastWeek.end, '2026-07-19');
  assert.equal(lastWeek.days, 7);
});

test('resolveToolPeriod: this_month / last_month', () => {
  const thisMonth = resolveToolPeriod({ period: 'this_month' }, 30, '', FIXED);
  assert.equal(thisMonth.label, '本月');
  assert.equal(thisMonth.start, '2026-07-01');
  assert.equal(thisMonth.end, '2026-07-26');
  assert.equal(thisMonth.days, 26);

  const lastMonth = resolveToolPeriod({}, 30, '上月营业额', FIXED);
  assert.equal(lastMonth.label, '上月');
  assert.equal(lastMonth.start, '2026-06-01');
  assert.equal(lastMonth.end, '2026-06-30');
  assert.equal(lastMonth.days, 30);
});

test('resolveToolPeriod: 近N天 and period_days fallback', () => {
  const near = resolveToolPeriod({}, 30, '近7天销售排行', FIXED);
  assert.equal(near.label, '近7天');
  assert.equal(near.days, 7);
  assert.equal(near.start, '2026-07-20');
  assert.equal(near.end, '2026-07-26');

  const fallback = resolveToolPeriod({ period_days: 14 }, 30, '', FIXED);
  assert.equal(fallback.label, '近14天');
  assert.equal(fallback.days, 14);
  assert.equal(fallback.start, '2026-07-13');

  const clamped = resolveToolPeriod({ period_days: 999 }, 7, '', FIXED);
  assert.equal(clamped.days, 90);
});

test('resolveToolPeriod: concrete date range / single day / month', () => {
  const range = resolveToolPeriod({}, 30, '查一下2月15日-22日销售', FIXED);
  assert.equal(range.start, '2026-02-15');
  assert.equal(range.end, '2026-02-22');
  assert.equal(range.days, 8);
  assert.match(range.label, /2月15日/);

  const single = resolveToolPeriod({}, 30, '2月15日营收', FIXED);
  assert.equal(single.start, '2026-02-15');
  assert.equal(single.end, '2026-02-15');
  assert.equal(single.days, 1);

  const month = resolveToolPeriod({}, 30, '2026年6月营业汇总', FIXED);
  assert.equal(month.start, '2026-06-01');
  assert.equal(month.end, '2026-06-30');
  assert.equal(month.label, '2026年6月');
});

test('resolveToolPeriod: same-month range / day-only / month span', () => {
  const same = resolveToolPeriod({}, 30, '7月10-15号销售', FIXED);
  assert.equal(same.start, '2026-07-10');
  assert.equal(same.end, '2026-07-15');
  assert.equal(same.days, 6);

  const dayOnly = resolveToolPeriod({}, 30, '查15号营收', FIXED);
  assert.equal(dayOnly.start, '2026-07-15');
  assert.equal(dayOnly.end, '2026-07-15');
  assert.equal(dayOnly.days, 1);

  const span = resolveToolPeriod({}, 30, '2026年1月到3月', FIXED);
  assert.equal(span.start, '2026-01-01');
  assert.equal(span.end, '2026-03-31');
  assert.match(span.label, /1月-.*3月/);

  const dual = resolveToolPeriod({}, 30, '11月 2月对比', FIXED);
  assert.equal(dual.start, '2026-11-01');
  assert.equal(dual.end, '2027-02-28');
});
