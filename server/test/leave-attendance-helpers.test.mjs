import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeaveAttendanceHelpers } from '../domains/leave-attendance/create-helpers.js';

const helpers = createLeaveAttendanceHelpers({
  safeDateOnly: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim().slice(0, 10) : null,
  safeMonthOnly: (v) => /^\d{4}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim().slice(0, 7) : null,
  isLegacyTestUsername: (u) => /^test_/i.test(String(u || '')),
  clampNum: (n, d = 0) => { const v = Number(n); return Number.isFinite(v) ? v : d; },
  hrmsNowISO: () => '2026-07-24T00:00:00.000Z',
  getSharedState: async () => ({}),
  mergeSharedStateFields: async () => {},
  pool: { query: async () => ({ rows: [] }) },
});

test('shiftMonth rolls year boundary', () => {
  assert.equal(helpers.shiftMonth('2026-07', -1), '2026-06');
  assert.equal(helpers.shiftMonth('2026-01', -1), '2025-12');
});

test('calcOverlapDaysWithinMonth counts days in target month', () => {
  assert.equal(helpers.calcOverlapDaysWithinMonth('2026-07-28', '2026-08-05', '2026-07'), 4);
});

test('leaveBalanceOverrideKey lowercases username', () => {
  assert.equal(helpers.leaveBalanceOverrideKey('Alice', '2026-07'), 'alice_2026-07');
  assert.equal(helpers.leaveBalanceOverrideKey('BOB', '2026-01'), 'bob_2026-01');
});

test('calcDateSpanDaysInclusive', () => {
  assert.equal(helpers.calcDateSpanDaysInclusive('2026-07-01', '2026-07-01'), 1);
  assert.equal(helpers.calcDateSpanDaysInclusive('2026-07-01', '2026-07-03'), 3);
  assert.equal(helpers.calcDateSpanDaysInclusive('bad', '2026-07-03'), null);
  assert.equal(helpers.calcDateSpanDaysInclusive('2026-07-05', '2026-07-01'), null);
});

test('isCountableCheckinStatus / shanghaiDateOnly smoke', () => {
  assert.equal(helpers.isCountableCheckinStatus('normal'), true);
  assert.equal(helpers.isCountableCheckinStatus('confirmed'), true);
  assert.equal(helpers.isCountableCheckinStatus('no_gps'), true);
  assert.equal(helpers.isCountableCheckinStatus(''), true);
  assert.equal(helpers.isCountableCheckinStatus('rejected'), false);
  const d = helpers.shanghaiDateOnly(new Date('2026-07-24T04:00:00.000Z'));
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
});

test('buildAttendanceFromCheckinRecords filters legacy test usernames', () => {
  const rows = [
    { username: 'alice', check_time: '2026-07-10T01:00:00.000Z', store: '洪潮久光店', status: 'normal', type: 'clock_in' },
    { username: 'test_bot', check_time: '2026-07-10T01:00:00.000Z', store: '洪潮久光店', status: 'normal', type: 'clock_in' },
  ];
  const out = helpers.buildAttendanceFromCheckinRecords(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].username, 'alice');
});

test('calcEmployeeMonthlyLeaveBalance no rest → remaining ≈ 4', () => {
  const bal = helpers.calcEmployeeMonthlyLeaveBalance(
    { dailyReports: [], leaveRecords: [], leaveBalanceOverrides: {} },
    { username: 'alice', name: 'Alice' },
    '2026-07'
  );
  assert.ok(bal);
  assert.equal(bal.baseLeave, 4);
  assert.equal(bal.usedLeave, 0);
  assert.equal(bal.remaining, 4);
  assert.ok(Array.isArray(bal.weeklyDetails));
  assert.ok(bal.weeklyDetails.length >= 1);
});

test('getLeaveBalanceOverride remaining mode', () => {
  const state = {
    leaveBalanceOverrides: {
      'alice_2026-07': { mode: 'remaining', value: 9.5 },
    },
  };
  const ov = helpers.getLeaveBalanceOverride(state, 'Alice', '2026-07');
  assert.equal(ov.mode, 'remaining');
  assert.equal(ov.value, 9.5);

  const bal = helpers.calcEmployeeMonthlyLeaveBalance(
    state,
    { username: 'alice', name: 'Alice' },
    '2026-07'
  );
  assert.equal(bal.remaining, 9.5);
  assert.equal(bal.overridden, true);
});

test('computeAttendanceMissingClockPenalties empty query → days 0', async () => {
  const map = await helpers.computeAttendanceMissingClockPenalties('2026-07', null, 'default');
  assert.ok(map instanceof Map);
  assert.equal(map.size, 0);
});
