import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sumHrmsStaffPersonDays,
  mergeDailyReportRestStaff,
  safeDateOnly,
  parseDailyReportStaffPayload,
  collectNamesNeedResolve,
  createUserResolver,
  collectOnReportUserKeys,
  resolveNamesToUsernames,
  fetchStoreActiveEmployeesUsernames,
  fetchClockSetForUsers,
  fetchLeaveMapForUsers,
  buildWorkRegisterLine,
  buildRestRegisterLine,
  buildRosterGapRegisterLines,
  buildAttendanceRegisterLineDetails,
  summarizeRegisterOverallStatus,
  upsertDailyReportAttendanceRegister,
} from '../daily-attendance-register-helpers.js';

function mockPool(handler) {
  return { query: async (sql, params) => handler(String(sql), params || []) };
}

test('sumHrmsStaffPersonDays / mergeDailyReportRestStaff / safeDateOnly', () => {
  assert.equal(sumHrmsStaffPersonDays([{ days: 0.5 }, { days: 2 }, {}]), 3.5);
  assert.equal(sumHrmsStaffPersonDays(null), 0);
  assert.equal(safeDateOnly('2026-07-01'), '2026-07-01');
  assert.equal(safeDateOnly('bad'), '');

  const merged = mergeDailyReportRestStaff({
    restStaff: [{ name: '甲' }],
    frontRestStaff: [{ user: 'bob' }],
    kitchenRestStaff: [{ name: '甲' }, { name: '乙' }],
  });
  assert.equal(merged.length, 3);
});

test('parseDailyReportStaffPayload / collectNamesNeedResolve / user resolver', () => {
  const parsed = parseDailyReportStaffPayload({
    front: [{ user: 'a', days: 1 }],
    kitchen: [{ name: '厨师', days: 2 }],
    restStaff: [{ name: '休' }],
  });
  assert.equal(parsed.frontPersonDays, 1);
  assert.equal(parsed.kitchenPersonDays, 2);
  assert.equal(parsed.restPersonDays, 1);

  const names = collectNamesNeedResolve(parsed.frontArr, parsed.kitchenArr, parsed.restMerged);
  assert.deepEqual(names.sort(), ['休', '厨师']);

  const resolveUser = createUserResolver(new Map([['厨师', 'chef1']]));
  assert.equal(resolveUser({ user: 'Alice' }), 'alice');
  assert.equal(resolveUser({ name: '厨师' }), 'chef1');
  assert.equal(resolveUser({ name: '未知' }), '');

  const keys = collectOnReportUserKeys(parsed.frontArr, parsed.kitchenArr, parsed.restMerged, resolveUser);
  assert.ok(keys.onReportUsernames.has('a'));
  assert.ok(keys.onReportUsernames.has('chef1'));
  assert.ok(keys.nameKeysOnReport.has('休'));
});

test('buildWorkRegisterLine / buildRestRegisterLine / roster gaps', () => {
  const clockSet = new Set(['alice']);
  const leaveMap = new Map([['alice', 1]]);
  const resolveUser = createUserResolver(new Map());

  const abnormalWork = buildWorkRegisterLine('front', { user: 'alice' }, resolveUser, clockSet, leaveMap);
  assert.equal(abnormalWork.status, 'abnormal');
  assert.ok(abnormalWork.reasons.some((r) => r.includes('休假')));

  const noUser = buildWorkRegisterLine('front', { name: '无名' }, resolveUser, clockSet, leaveMap);
  assert.equal(noUser.status, 'abnormal');

  const rest = buildRestRegisterLine({ user: 'bob' }, resolveUser, clockSet, leaveMap);
  assert.equal(rest.kind, 'rest');
  assert.equal(rest.status, 'verified');

  const gaps = buildRosterGapRegisterLines({
    rosterRows: [
      { u: 'leave_only', name: 'Leave' },
      { u: 'absent1', name: 'Absent' },
      { u: 'on_report', name: 'OnReport' },
    ],
    onReportUsernames: new Set(['on_report']),
    nameKeysOnReport: new Set(['by_name']),
    clockSet: new Set(['absent1']),
    leaveMap: new Map([['leave_only', 1]]),
  });
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].kind, 'leave_only');
  assert.equal(gaps[1].kind, 'absent');
  assert.ok(gaps[1].reasons.some((r) => r.includes('打卡')));
});

test('buildAttendanceRegisterLineDetails + summarizeRegisterOverallStatus', () => {
  const resolveUser = createUserResolver(new Map());
  const clockSet = new Set(['worker']);
  const leaveMap = new Map();
  const lines = buildAttendanceRegisterLineDetails({
    frontArr: [{ user: 'worker' }],
    kitchenArr: [],
    restMerged: [{ user: 'rest1' }],
    resolveUser,
    clockSet,
    leaveMap,
    rosterRows: [{ u: 'ghost', name: 'Ghost' }],
    onReportUsernames: new Set(['worker', 'rest1']),
    nameKeysOnReport: new Set(),
  });
  assert.equal(lines.length, 3);
  const summary = summarizeRegisterOverallStatus(lines);
  assert.equal(summary.anomalyCount, 1);
  assert.equal(summary.overallStatus, 'abnormal');
});

test('resolveNamesToUsernames / fetchStoreActiveEmployeesUsernames', async () => {
  const pool = mockPool(async (sql) => {
    if (/SELECT LOWER\(TRIM\(username\)\) AS u, TRIM\(name\)/.test(sql)) {
      return { rows: [{ u: 'chef1', name: '厨师' }] };
    }
    if (/DISTINCT ON \(LOWER\(TRIM\(username\)\)\)/.test(sql)) {
      return { rows: [{ u: 'alice', name: 'Alice' }] };
    }
    throw new Error('unexpected');
  });
  const nameMap = await resolveNamesToUsernames(pool, '洪潮', ['厨师'], 'default');
  assert.equal(nameMap.get('厨师'), 'chef1');
  const roster = await fetchStoreActiveEmployeesUsernames(pool, '洪潮', 'default');
  assert.equal(roster[0].u, 'alice');

  const emptyStore = await fetchStoreActiveEmployeesUsernames(pool, '', 'default');
  assert.deepEqual(emptyStore, []);

  const failPool = mockPool(async () => { throw new Error('db'); });
  assert.deepEqual(await resolveNamesToUsernames(failPool, '洪潮', ['x'], 'default'), new Map());
  assert.deepEqual(await fetchStoreActiveEmployeesUsernames(failPool, '洪潮', 'default'), []);
});

test('fetchClockSetForUsers / fetchLeaveMapForUsers', async () => {
  const pool = mockPool(async (sql) => {
    if (/checkin_records/.test(sql)) return { rows: [{ u: 'alice' }] };
    if (/hrms_leave_records/.test(sql)) return { rows: [{ u: 'bob', c: 2 }] };
    return { rows: [] };
  });
  const clock = await fetchClockSetForUsers(pool, '2026-07-01', ['alice']);
  assert.ok(clock.has('alice'));
  assert.deepEqual(await fetchClockSetForUsers(pool, '2026-07-01', []), new Set());

  const leave = await fetchLeaveMapForUsers(pool, '2026-07-01', ['bob'], 'default');
  assert.equal(leave.get('bob'), 2);

  const failPool = mockPool(async () => { throw new Error('down'); });
  assert.deepEqual(await fetchClockSetForUsers(failPool, '2026-07-01', ['x']), new Set());
  assert.deepEqual(await fetchLeaveMapForUsers(failPool, '2026-07-01', ['x'], 'default'), new Map());
});

test('upsertDailyReportAttendanceRegister', async () => {
  let captured = null;
  const pool = mockPool(async (sql, params) => {
    captured = { sql, params };
    return { rows: [] };
  });
  await upsertDailyReportAttendanceRegister(pool, {
    store: '洪潮',
    brand: '洪潮',
    reportDate: '2026-07-01',
    laborTotal: 100,
    frontPersonDays: 1,
    kitchenPersonDays: 2,
    restPersonDays: 0,
    staffObj: { front: [] },
    lineDetails: [{ kind: 'work' }],
    overallStatus: 'verified',
    anomalyCount: 0,
    tenantId: 'default',
  });
  assert.match(captured.sql, /INSERT INTO daily_report_attendance_register/);
  assert.equal(captured.params[0], '洪潮');
  assert.equal(captured.params[10], 0);
  assert.equal(captured.params[11], 'default');
});
