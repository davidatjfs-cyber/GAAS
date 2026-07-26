/**
 * domains/growth-ops/daily-report.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cnHour, shiftDate, growthStoreName } from '../daily-report.js';

test('shiftDate：UTC 安全日期加减', () => {
  assert.equal(shiftDate('2026-07-20', -1), '2026-07-19');
  assert.equal(shiftDate('2026-07-20', 7), '2026-07-27');
});

test('cnHour：北京时间小时', () => {
  assert.equal(cnHour('2026-07-26T03:00:00.000Z'), 11);
});

test('growthStoreName：未知 code 原样返回', () => {
  assert.equal(growthStoreName('unknown_code_xyz'), 'unknown_code_xyz');
});
