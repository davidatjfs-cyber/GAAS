import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthBounds,
  splitNameTokens,
  computeAttendanceCounts,
  sumRestDays,
  buildAttendanceOverviewPayload,
} from '../attendance-overview-helpers.js';

test('monthBounds returns first and last day of month', () => {
  const { monthStart, monthEnd } = monthBounds('2026-02');
  assert.equal(monthStart, '2026-02-01');
  assert.equal(monthEnd, '2026-02-28');
});

test('splitNameTokens splits mixed separators', () => {
  assert.deepEqual(splitNameTokens('张三,李四、王五'), ['张三', '李四', '王五']);
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
