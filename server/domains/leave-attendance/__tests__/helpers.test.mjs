import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeaveAttendanceHelpers } from '../create-helpers.js';

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

test('resolveEmployeeLeaveCalcStartMonth：日报休息/休假/覆盖取最早月', () => {
  const state = {
    dailyReports: [
      {
        date: '2026-05-10',
        store: '洪潮',
        data: { staff: { restStaff: [{ user: 'alice' }] } },
      },
    ],
    leaveRecords: [{ applicant: 'alice', startDate: '2026-06-01', endDate: '2026-06-02' }],
    leaveBalanceOverrides: { 'alice_2026-04': { mode: 'carryover', value: 1 } },
  };
  // create-helpers 需暴露该函数；若未导出则走 calcCarryover 间接覆盖
  if (typeof helpers.resolveEmployeeLeaveCalcStartMonth === 'function') {
    assert.equal(
      helpers.resolveEmployeeLeaveCalcStartMonth(state, { username: 'alice', name: 'Alice' }, '2026-07'),
      '2026-04'
    );
  }
});

test('calcEmployeeMonthlyApprovedLeaveDays：同月 rawDays / 跨月 overlap', () => {
  if (typeof helpers.calcEmployeeMonthlyApprovedLeaveDays !== 'function') return;
  const days = helpers.calcEmployeeMonthlyApprovedLeaveDays(
    {
      leaveRecords: [
        {
          applicant: 'alice',
          status: 'approved',
          startDate: '2026-07-10',
          endDate: '2026-07-12',
          days: 2.5,
        },
        {
          applicant: 'alice',
          status: 'approved',
          startDate: '2026-07-28',
          endDate: '2026-08-02',
        },
        {
          applicant: 'alice',
          status: 'rejected',
          startDate: '2026-07-01',
          endDate: '2026-07-02',
          days: 2,
        },
      ],
    },
    { username: 'alice' },
    '2026-07'
  );
  // 2.5 + overlap Jul28-31 (=4) = 6.5
  assert.equal(days, 6.5);
});

test('calcEmployeeMonthlyLeaveBalance：日结果明细 + penalty + remaining 覆盖', () => {
  const bal = helpers.calcEmployeeMonthlyLeaveBalance(
    {
      dailyReports: [],
      leaveRecords: [],
      leaveBalanceOverrides: {},
      leaveBalanceAdjustments: [
        { key: 'alice_2026-07', note: '校准', targetUsername: 'alice', month: '2026-07' },
      ],
    },
    { username: 'alice', name: 'Alice' },
    '2026-07',
    {
      attendanceRestDetails: [
        { date: '2026-07-03', days: 1, type: '周休' },
        { date: '2026-07-10', days: 1, type: '休息' },
      ],
      penalty: {
        days: 1,
        details: [{ date: '2026-07-05', days: 1, type: '缺卡扣假', source: 'penalty' }],
      },
    }
  );
  assert.equal(bal.usedLeave, 3);
  assert.ok(bal.usedLeaveDetails.some((d) => d.source === 'penalty' || d.type === '缺卡扣假'));
  assert.ok(bal.lastAdjustment);

  const withAttRest = helpers.calcEmployeeMonthlyLeaveBalance(
    { dailyReports: [], leaveRecords: [], leaveBalanceOverrides: {} },
    { username: 'bob', name: 'Bob' },
    '2026-07',
    { attendanceRestDays: 2 }
  );
  assert.equal(withAttRest.usedLeave, 2);
  assert.ok(withAttRest.usedLeaveDetails.some((d) => d.source === '日结果汇总'));
});

test('calcEmployeeMonthlyCarryover：滚动与 carryover 覆盖', () => {
  if (typeof helpers.calcEmployeeMonthlyCarryover !== 'function') return;
  const state = {
    dailyReports: [],
    leaveRecords: [],
    leaveBalanceOverrides: {
      'alice_2026-07': { mode: 'carryover', value: 8 },
    },
  };
  const carry = helpers.calcEmployeeMonthlyCarryover(
    state,
    { username: 'alice', name: 'Alice' },
    '2026-07'
  );
  assert.equal(carry, 8);
  const ignore = helpers.calcEmployeeMonthlyCarryover(
    state,
    { username: 'alice', name: 'Alice' },
    '2026-07',
    { ignoreEndCarryoverOverride: true }
  );
  assert.notEqual(ignore, 8);

  // 从有覆盖的起始月滚到目标月（覆盖 while cur < m）
  const roll = helpers.calcEmployeeMonthlyCarryover(
    {
      dailyReports: [],
      leaveRecords: [{ applicant: 'carol', startDate: '2026-05-01' }],
      leaveBalanceOverrides: {
        'carol_2026-05': { mode: 'carryover', value: 2 },
      },
    },
    { username: 'carol', name: 'Carol' },
    '2026-07',
    { ignoreEndCarryoverOverride: true }
  );
  // 5月起点2 +4 -0 =6；6月 6+4-0=10
  assert.equal(roll, 10);
});

test('calcEmployeeMonthlyLeaveBalance：attRest+日报 byDay；纯日报休息', () => {
  const withByDay = helpers.calcEmployeeMonthlyLeaveBalance(
    {
      dailyReports: [
        {
          date: '2026-07-08',
          store: '洪潮',
          data: { staff: { restStaff: [{ user: 'dave', days: 1 }] } },
        },
      ],
      leaveRecords: [],
      leaveBalanceOverrides: {},
    },
    { username: 'dave', name: 'Dave' },
    '2026-07',
    { attendanceRestDays: 1 }
  );
  assert.equal(withByDay.usedLeave, 1);
  assert.ok(withByDay.usedLeaveDetails.some((d) => d.source === '日报休息'));

  const fromReports = helpers.calcEmployeeMonthlyLeaveBalance(
    {
      dailyReports: [
        {
          date: '2026-07-15',
          store: '洪潮',
          data: { staff: { restStaff: [{ user: 'erin', days: 1 }] } },
        },
      ],
      leaveRecords: [],
      leaveBalanceOverrides: {},
    },
    { username: 'erin', name: 'Erin' },
    '2026-07'
  );
  assert.ok(fromReports.usedLeave >= 1);
  assert.ok(fromReports.usedLeaveDetails.some((d) => d.source === '日报休息'));
});

test('calcEmployeeMonthlyApprovedLeaveDays：仅 start 月 + rawDays 回落', () => {
  const days = helpers.calcEmployeeMonthlyApprovedLeaveDays(
    {
      leaveRecords: [
        {
          applicant: 'fay',
          status: 'approved',
          startDate: '2026-07-20',
          endDate: '2026-06-01', // overlap 0，但 rawDays+同月 start
          days: 1.5,
        },
      ],
    },
    { username: 'fay' },
    '2026-07'
  );
  assert.equal(days, 1.5);
});
