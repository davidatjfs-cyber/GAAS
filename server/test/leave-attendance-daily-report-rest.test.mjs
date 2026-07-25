/**
 * domains/leave-attendance/daily-report-rest.js 日报休息解析单测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyReportRestStaffForLeaveCalc,
  dailyReportHasRestForEmployee,
  dailyReportRestDaysForEmployee,
  createDailyReportRestHelpers,
} from '../domains/leave-attendance/daily-report-rest.js';

test('dailyReportRestStaffForLeaveCalc：合并三表并按 user/name 去重', () => {
  const out = dailyReportRestStaffForLeaveCalc({
    restStaff: [{ user: 'Alice', name: '甲' }],
    frontRestStaff: [{ username: 'alice', name: '甲重复' }, { name: '乙' }],
    kitchenRestStaff: [{ name: '乙' }, { user: 'bob', name: '丙' }],
  });
  assert.equal(out.length, 3);
  assert.equal(dailyReportRestStaffForLeaveCalc(null).length, 0);
  assert.equal(dailyReportRestStaffForLeaveCalc([]).length, 0);
});

test('dailyReportHasRestForEmployee：username / 仅 name / 双空', () => {
  const staff = {
    restStaff: [{ user: 'u1', name: '张三' }],
    frontRestStaff: [{ name: '李四' }],
  };
  assert.equal(dailyReportHasRestForEmployee(staff, 'U1', ''), true);
  assert.equal(dailyReportHasRestForEmployee(staff, '', '李四'), true);
  assert.equal(dailyReportHasRestForEmployee(staff, 'nobody', '王五'), false);
  assert.equal(dailyReportHasRestForEmployee(staff, '', ''), false);
});

test('dailyReportRestDaysForEmployee：days 精度与默认 1', () => {
  const staff = {
    restStaff: [{ user: 'u1', days: 0.5 }, { name: '赵六' }],
  };
  assert.equal(dailyReportRestDaysForEmployee(staff, 'u1', ''), 0.5);
  assert.equal(dailyReportRestDaysForEmployee(staff, '', '赵六'), 1);
  assert.equal(dailyReportRestDaysForEmployee(staff, 'x', 'y'), 0);
  assert.equal(dailyReportRestDaysForEmployee(staff, '', ''), 0);
});

test('calcEmployeeMonthlyActualRestFromDailyReports：累加 + legacy 姓名串', () => {
  const { calcEmployeeMonthlyActualRestFromDailyReports } = createDailyReportRestHelpers({
    safeMonthOnly: (m) => (String(m || '').match(/^\d{4}-\d{2}$/) ? String(m) : ''),
  });

  const state = {
    dailyReports: [
      {
        date: '2026-07-01',
        data: { staff: { restStaff: [{ user: 'emp1', days: 0.5 }] } },
      },
      {
        date: '2026-07-02',
        data: { staff: { frontRest: '张三,李四', kitchenRest: '' } },
      },
      {
        date: '2026-06-30',
        data: { staff: { restStaff: [{ user: 'emp1', days: 1 }] } },
      },
    ],
  };

  const half = calcEmployeeMonthlyActualRestFromDailyReports(
    state,
    { username: 'emp1', name: '张三' },
    '2026-07'
  );
  assert.equal(half.total, 1.5);
  assert.equal(half.byDay['2026-07-01'], 0.5);
  assert.equal(half.byDay['2026-07-02'], 1);

  const empty = calcEmployeeMonthlyActualRestFromDailyReports(state, {}, '2026-07');
  assert.equal(empty.total, 0);

  const badMonth = calcEmployeeMonthlyActualRestFromDailyReports(
    state,
    { username: 'emp1' },
    'bad'
  );
  assert.equal(badMonth.total, 0);
});
