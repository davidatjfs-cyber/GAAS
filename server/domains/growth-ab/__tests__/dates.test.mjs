/**
 * domains/growth-ab/dates.js 纯日期工具单测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeDateOnly,
  ymdAddDays,
  todayShanghaiYmd,
  diffDaysInclusive,
} from '../dates.js';

test('safeDateOnly：严格 ISO 原样返回；非法→空；可解析→截断', () => {
  assert.equal(safeDateOnly('2026-07-23'), '2026-07-23');
  assert.equal(safeDateOnly(''), '');
  assert.equal(safeDateOnly(null), '');
  assert.equal(safeDateOnly('not-a-date'), '');
  assert.equal(safeDateOnly('2026-07-23T12:00:00.000Z'), '2026-07-23');
});

test('ymdAddDays：跨月与非法', () => {
  assert.equal(ymdAddDays('2026-01-31', 1), '2026-02-01');
  assert.equal(ymdAddDays('2026-07-01', 0), '2026-07-01');
  assert.equal(ymdAddDays('bad', 1), '');
});

test('diffDaysInclusive：同日/区间/逆序', () => {
  assert.equal(diffDaysInclusive('2026-07-01', '2026-07-01'), 1);
  assert.equal(diffDaysInclusive('2026-07-01', '2026-07-03'), 3);
  assert.equal(diffDaysInclusive('2026-07-03', '2026-07-01'), 0);
  assert.equal(diffDaysInclusive('bad', '2026-07-01'), 0);
});

test('todayShanghaiYmd：YYYY-MM-DD', () => {
  assert.match(todayShanghaiYmd(), /^\d{4}-\d{2}-\d{2}$/);
});
