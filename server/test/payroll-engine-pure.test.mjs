/**
 * L1：薪资引擎纯函数 — 在职天数 / 月中入离职。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countActiveCalendarDaysInMonth,
  isMidMonthEmployment,
} from '../services/hrms-payroll-engine.js';

test('countActiveCalendarDaysInMonth: 整月在职', () => {
  assert.equal(
    countActiveCalendarDaysInMonth({ month: '2026-07', joinDate: '2025-01-01', resignDate: '' }),
    31
  );
});

test('countActiveCalendarDaysInMonth: 月中入职截断', () => {
  // 7月15入职 → 15..31 = 17 天
  assert.equal(
    countActiveCalendarDaysInMonth({ month: '2026-07', joinDate: '2026-07-15', resignDate: null }),
    17
  );
});

test('countActiveCalendarDaysInMonth: 月中离职截断', () => {
  // 7月10离职 → 1..10 = 10 天
  assert.equal(
    countActiveCalendarDaysInMonth({ month: '2026-07', joinDate: '2026-01-01', resignDate: '2026-07-10' }),
    10
  );
});

test('countActiveCalendarDaysInMonth: 入职晚于离职 → 0', () => {
  assert.equal(
    countActiveCalendarDaysInMonth({ month: '2026-07', joinDate: '2026-07-20', resignDate: '2026-07-10' }),
    0
  );
});

test('isMidMonthEmployment: 月中入职/离职为 true，整月为 false', () => {
  assert.equal(isMidMonthEmployment({ month: '2026-07', joinDate: '2026-07-15', resignDate: '' }), true);
  assert.equal(isMidMonthEmployment({ month: '2026-07', joinDate: '2026-01-01', resignDate: '2026-07-10' }), true);
  assert.equal(isMidMonthEmployment({ month: '2026-07', joinDate: '2026-01-01', resignDate: '' }), false);
});
