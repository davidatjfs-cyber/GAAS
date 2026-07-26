import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateOnly,
  toDateOnly,
  shiftDate,
  normalizeStaffUser,
  normalizeStaffName,
  monthBounds,
  splitNameTokens,
  buildCheckinByDay,
  buildScheduleAndRestMaps,
  computeAttendanceCounts,
  sumRestDays,
  buildAttendanceOverviewPayload,
} from '../attendance-overview-helpers.js';

test('parseDateOnly / toDateOnly / shiftDate', () => {
  assert.equal(parseDateOnly('bad'), null);
  const d = parseDateOnly('2026-07-15');
  assert.ok(d instanceof Date);
  assert.equal(toDateOnly(d), '2026-07-15');
  assert.equal(toDateOnly(new Date('invalid')), '');
  assert.equal(shiftDate('2026-07-15', 1), '2026-07-16');
  assert.equal(shiftDate('invalid', 1), '');
});

test('normalizeStaffUser / normalizeStaffName', () => {
  assert.equal(normalizeStaffUser({ user: 'Bob' }), 'bob');
  assert.equal(normalizeStaffUser({ username: 'Alice' }), 'alice');
  assert.equal(normalizeStaffName({ name: ' 张三 ' }), '张三');
});

test('monthBounds returns first and last day of month', () => {
  const { monthStart, monthEnd } = monthBounds('2026-02');
  assert.equal(monthStart, '2026-02-01');
  assert.equal(monthEnd, '2026-02-28');
});

test('splitNameTokens splits mixed separators', () => {
  assert.deepEqual(splitNameTokens('张三,李四、王五'), ['张三', '李四', '王五']);
});

test('buildCheckinByDay groups by Shanghai day key', () => {
  const checkinByDay = buildCheckinByDay(
    [{ check_time: '2026-07-02T01:00:00.000Z', type: 'clock_in' }],
    '2026-07',
    () => '2026-07-02'
  );
  assert.equal(checkinByDay.get('2026-07-02').length, 1);
  assert.equal(checkinByDay.get('2026-07-02')[0].type, 'clock_in');
});

test('buildScheduleAndRestMaps: rest via dailyReportRestDaysForEmployee', () => {
  const { restByDay, scheduleByDay } = buildScheduleAndRestMaps({
    reportList: [{
      store: 'A店',
      date: '2026-07-01',
      data: { staff: { frontRest: 'Bob' } },
    }],
    myStore: 'A店',
    meLower: 'bob',
    myName: 'Bob',
    monthStart: '2026-07-01',
    monthEnd: '2026-07-31',
    dailyReportRestDaysForEmployee: () => 1,
  });
  assert.equal(restByDay.get('2026-07-01'), 1);
  const plan = scheduleByDay.get('2026-07-02');
  assert.equal(plan?.planned, false);
});

test('buildScheduleAndRestMaps: rest via token match and schedule next day', () => {
  const { restByDay, scheduleByDay } = buildScheduleAndRestMaps({
    reportList: [{
      store: 'A店',
      date: '2026-07-01',
      data: {
        staff: { frontRest: 'alice,bob', kitchenRest: '' },
        scheduleNextDay: {
          morningStaff: [{ username: 'bob', name: 'Bob' }],
          afternoonStaff: [{ name: 'Bob' }],
        },
      },
    }],
    myStore: 'A店',
    meLower: 'bob',
    myName: 'Bob',
    monthStart: '2026-07-01',
    monthEnd: '2026-07-31',
    dailyReportRestDaysForEmployee: () => 0,
  });
  assert.equal(restByDay.get('2026-07-01'), 1);
  const plan = scheduleByDay.get('2026-07-02');
  assert.equal(plan.planned, true);
  assert.equal(plan.morning, true);
  assert.equal(plan.afternoon, true);
});

test('buildScheduleAndRestMaps: skips other store reports', () => {
  const { scheduleByDay, restByDay } = buildScheduleAndRestMaps({
    reportList: [{ store: 'B店', date: '2026-07-01', data: { staff: {} } }],
    myStore: 'A店',
    meLower: 'bob',
    myName: 'Bob',
    monthStart: '2026-07-01',
    monthEnd: '2026-07-31',
    dailyReportRestDaysForEmployee: () => 1,
  });
  assert.equal(restByDay.size, 0);
  assert.equal(scheduleByDay.size, 0);
});

test('computeAttendanceCounts: absent when planned but no checkins', () => {
  const scheduleByDay = new Map([['2026-07-02', { planned: true, morning: true, afternoon: false }]]);
  const checkinByDay = new Map();
  const out = computeAttendanceCounts({
    scheduleByDay,
    checkinByDay,
    attWin: { startMinutes: 540, endMinutes: 1320 },
    hrmsClockMinutesInShanghai: () => 600,
  });
  assert.equal(out.absentCount, 1);
  assert.equal(out.lateCount, 0);
});

test('computeAttendanceCounts: late and early leave', () => {
  const day = '2026-07-03';
  const scheduleByDay = new Map([[day, { planned: true, morning: true, afternoon: true }]]);
  const checkinByDay = new Map([[day, [
    { type: 'clock_in', date: new Date('2026-07-03T02:00:00.000Z') },
    { type: 'clock_out', date: new Date('2026-07-03T12:00:00.000Z') },
  ]]]);
  const out = computeAttendanceCounts({
    scheduleByDay,
    checkinByDay,
    attWin: { startMinutes: 540, endMinutes: 1320 },
    hrmsClockMinutesInShanghai: (d) => (d.getUTCHours() === 2 ? 600 : 1200),
  });
  assert.equal(out.absentCount, 0);
  assert.equal(out.lateCount, 1);
  assert.equal(out.earlyLeaveCount, 1);
});

test('sumRestDays aggregates positive rest days', () => {
  const restByDay = new Map([['2026-07-01', 1], ['2026-07-02', 0.5]]);
  assert.equal(sumRestDays(restByDay), 1.5);
});

test('buildAttendanceOverviewPayload: monthRestRemaining fallback without leaveBalance', () => {
  const out = buildAttendanceOverviewPayload({
    month: '2026-07',
    username: 'alice',
    myName: 'Alice',
    leaveBalance: null,
    absentCount: 0,
    lateCount: 0,
    earlyLeaveCount: 0,
    restDays: 1,
  });
  assert.equal(out.ok, true);
  assert.equal(out.monthRestRemaining, 3);
  assert.equal(out.leave, null);
});

test('buildAttendanceOverviewPayload: with leaveBalance', () => {
  const out = buildAttendanceOverviewPayload({
    month: '2026-07',
    username: 'bob',
    myName: 'Bob',
    leaveBalance: {
      baseLeave: 4,
      annualLeave: 5,
      usedLeave: 1,
      totalLeave: 9,
      cumulativeLeaveDays: 2,
      monthRemaining: 2,
      computedRemaining: 2,
      remaining: 2,
      overridden: false,
      cumulativeLeaveManualLock: true,
      weeklyDetails: [{ week: 1 }],
      lastAdjustment: { by: 'admin' },
    },
    absentCount: 1,
    lateCount: 2,
    earlyLeaveCount: 0,
    restDays: 1,
  });
  assert.equal(out.monthRestRemaining, 2);
  assert.equal(out.cumulativeLeaveDays, 2);
  assert.equal(out.leave.baseLeave, 4);
  assert.equal(out.cumulativeLeaveManualLock, true);
});
