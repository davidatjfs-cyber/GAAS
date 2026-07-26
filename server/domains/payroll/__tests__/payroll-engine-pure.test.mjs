/**
 * L1：薪资引擎纯函数 — 在职天数 / 月中入离职 / computePayrollLine。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countActiveCalendarDaysInMonth,
  isMidMonthEmployment,
  computePayrollLine,
} from '../../../services/hrms-payroll-engine.js';
import { cloneDefaultRules } from '../../../services/hrms-payroll-rules.js';

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

const baseRules = () => cloneDefaultRules(); // monthlyRestDays=4 → Jul denom 27

test('computePayrollLine: 整月出勤 + 账本分类 + 补贴相加', () => {
  const line = computePayrollLine({
    rules: baseRules(),
    month: '2026-07',
    monthlySalary: 5400,
    attendanceSummary: { workDays: 27 },
    leaveRemaining: 0,
    ledgerItems: [
      { entry_type: 'points', amount: 10 },
      { entryType: 'reward', amount: 50 },
      { entry_type: 'punishment', amount: -20 },
      { entry_type: 'manual_subsidy', amount: 30 },
      { entry_type: 'other', amount: 5 },
    ],
    joinDate: '2025-01-01',
    resignDate: '',
  });
  assert.equal(line.workDaysPerMonth, 27);
  assert.equal(line.dailyRate, 200);
  assert.equal(line.payableAttendanceDays, 27);
  assert.equal(line.prorationMode, 'attendance');
  assert.equal(line.baseAmount, 5400);
  assert.equal(line.pointsAmount, 10);
  assert.equal(line.manualSubsidy, 30);
  assert.equal(line.subsidy, 40);
  assert.equal(line.rewardPunishmentAdj, 30);
  assert.equal(line.amount, 5475);
});

test('computePayrollLine: 月中入职按日历天折算', () => {
  const line = computePayrollLine({
    rules: baseRules(),
    month: '2026-07',
    monthlySalary: 5400,
    attendanceSummary: { workDays: 10 },
    leaveRemaining: 0,
    ledgerItems: [],
    joinDate: '2026-07-15',
    resignDate: '',
  });
  assert.equal(line.prorationMode, 'active_calendar_days');
  assert.equal(line.payableAttendanceDays, 17);
  assert.equal(line.baseAmount, 3400);
});

test('computePayrollLine: 倒欠假期仍全勤；缺勤用剩余假抵扣', () => {
  const owe = computePayrollLine({
    rules: baseRules(),
    month: '2026-07',
    monthlySalary: 5400,
    attendanceSummary: { workDays: 20 },
    leaveRemaining: -2,
    ledgerItems: [],
    joinDate: '2025-01-01',
  });
  assert.equal(owe.payableAttendanceDays, 27);

  const offset = computePayrollLine({
    rules: baseRules(),
    month: '2026-07',
    monthlySalary: 5400,
    attendanceSummary: { workDays: 25 },
    leaveRemaining: 3,
    ledgerItems: [],
    joinDate: '2025-01-01',
  });
  // missing=2, leaveOffset=2 → 27
  assert.equal(offset.payableAttendanceDays, 27);

  const noOffset = computePayrollLine({
    rules: { ...baseRules(), offsetMissingWithRemainingLeave: false, oweLeaveStillFullAttendance: false },
    month: '2026-07',
    monthlySalary: 5400,
    attendanceSummary: { workDays: 25 },
    leaveRemaining: 10,
    ledgerItems: [],
    joinDate: '2025-01-01',
  });
  assert.equal(noOffset.payableAttendanceDays, 25);
});

test('computePayrollLine: 无底薪仍计补贴；补贴取 max；leaveRemaining 非法', () => {
  const line = computePayrollLine({
    rules: { ...baseRules(), manualSubsidyAddsWithPoints: false },
    month: '2026-07',
    monthlySalary: null,
    attendanceSummary: { workDays: 27 },
    leaveRemaining: 'x',
    ledgerItems: [
      { entry_type: 'points', amount: 10 },
      { entry_type: 'manual_subsidy', amount: 40 },
    ],
    joinDate: '2025-01-01',
  });
  assert.equal(line.baseAmount, null);
  assert.equal(line.dailyRate, null);
  assert.equal(line.leaveRemaining, null);
  assert.equal(line.subsidy, 40);
  assert.equal(line.amount, 40);
});
