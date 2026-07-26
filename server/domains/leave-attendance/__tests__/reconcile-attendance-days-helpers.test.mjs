import test from 'node:test';
import assert from 'node:assert/strict';
import {
  safeDateOnly,
  datesInRange,
  leaveTypeNeedsApproval,
  filterStorePeopleFromState,
  loadReconcilePeople,
  loadReportsByDateFromState,
  mergeReportsByDateFromRegister,
  loadPunchMapForReconcile,
  mergeLeaveByUserDateFromState,
  loadLeaveByUserDateForReconcile,
  loadConfirmMapForReconcile,
  classifyAttendanceDayResult,
  upsertAttendanceDayRow,
  runReconcileAttendanceDaysLoop,
} from '../reconcile-attendance-days-helpers.js';
import { classifyFromDailyReportStaff } from '../../../services/hrms-attendance-day.js';

function mockDb(handler) {
  return { query: async (sql, params) => handler(String(sql), params || []) };
}

const DEFAULT_RULES = {
  requireClockInAndOut: true,
  approvedLeaveAuthoritative: true,
  noPunchWithSchedule: 'auto_rest',
  approvedLeaveTypesRequireApproval: ['事假', '病假'],
};

test('safeDateOnly / datesInRange / leaveTypeNeedsApproval', () => {
  assert.equal(safeDateOnly('2026-07-01'), '2026-07-01');
  assert.equal(safeDateOnly('x'), '');
  assert.deepEqual(datesInRange('2026-07-01', '2026-07-03'), ['2026-07-01', '2026-07-02', '2026-07-03']);
  assert.deepEqual(datesInRange('2026-07-03', '2026-07-01'), []);

  assert.equal(leaveTypeNeedsApproval('事假', DEFAULT_RULES), true);
  assert.equal(
    leaveTypeNeedsApproval('周休', { approvedLeaveTypesRequireApproval: ['事假'] }),
    false
  );
});

test('filterStorePeopleFromState / loadReconcilePeople', async () => {
  const emps = [
    { username: 'a', store: '洪潮', status: '在职' },
    { username: 'b', store: '洪潮', status: '离职' },
    { username: '', store: '洪潮', status: '在职' },
    { username: 'c', store: '其它', status: '在职' },
  ];
  assert.equal(filterStorePeopleFromState(emps, '洪潮').length, 1);

  const fromDb = await loadReconcilePeople({
    db: mockDb(async (sql) => {
      assert.match(sql, /FROM employees/);
      return { rows: [{ username: 'db1', name: 'Db', store: '洪潮' }] };
    }),
    tid: 'default',
    st: '洪潮',
    state: { employees: [] },
  });
  assert.equal(fromDb[0].username, 'db1');

  const fromState = await loadReconcilePeople({
    db: mockDb(async () => { throw new Error('skip'); }),
    tid: 'default',
    st: '洪潮',
    state: { employees: [{ username: 's1', store: '洪潮', status: 'active' }] },
  });
  assert.equal(fromState[0].username, 's1');
});

test('loadReportsByDateFromState / mergeReportsByDateFromRegister', async () => {
  const map = loadReportsByDateFromState([
    { date: '2026-07-01', store: '洪潮', data: { staff: { front: [{ user: 'a' }] } } },
    { date: '2026-06-01', store: '洪潮', data: { staff: {} } },
    { date: '2026-07-02', store: '其它', data: { staff: {} } },
  ], { st: '洪潮', start: '2026-07-01', end: '2026-07-31' });
  assert.ok(map.has('2026-07-01'));
  assert.equal(map.size, 1);

  const merged = await mergeReportsByDateFromRegister({
    db: mockDb(async () => ({
      rows: [
        { d: '2026-07-02', staff_snapshot: JSON.stringify({ front: [{ user: 'b' }] }) },
        { d: '2026-07-01', staff_snapshot: '{"bad"' },
      ],
    })),
    tid: 'default',
    st: '洪潮',
    start: '2026-07-01',
    end: '2026-07-03',
    reportsByDate: map,
  });
  assert.ok(merged.has('2026-07-01'));
  assert.ok(merged.has('2026-07-02'));
  assert.deepEqual(merged.get('2026-07-02').front[0].user, 'b');
});

test('loadPunchMapForReconcile / loadLeave / loadConfirm', async () => {
  const punch = await loadPunchMapForReconcile({
    db: mockDb(async (sql) => {
      assert.match(sql, /checkin_records/);
      return {
        rows: [
          { u: 'alice', d: '2026-07-01', type: 'clock_in' },
          { u: 'alice', d: '2026-07-01', type: 'clock_out' },
        ],
      };
    }),
    tid: 'default',
    st: '洪潮',
    start: '2026-07-01',
    end: '2026-07-01',
  });
  assert.equal(punch.get('alice|2026-07-01').in, true);
  assert.equal(punch.get('alice|2026-07-01').out, true);

  const stateLeave = mergeLeaveByUserDateFromState([
    { applicant: 'bob', status: 'approved', startDate: '2026-07-02', endDate: '2026-07-02', type: '病假', id: 's1' },
    { applicant: 'rej', status: 'rejected', startDate: '2026-07-02', endDate: '2026-07-02', type: '事假' },
  ], { start: '2026-07-01', end: '2026-07-03' });
  assert.equal(stateLeave.get('bob|2026-07-02').type, '病假');

  const leave = await loadLeaveByUserDateForReconcile({
    db: mockDb(async (sql) => {
      if (/hrms_leave_records/.test(sql)) {
        return { rows: [{ id: 'lv1', u: 'alice', sd: '2026-07-01', ed: '2026-07-01', type: '事假' }] };
      }
      return { rows: [] };
    }),
    tid: 'default',
    start: '2026-07-01',
    end: '2026-07-03',
    stateLeaves: [{ applicant: 'bob', status: 'approved', startDate: '2026-07-02', endDate: '2026-07-02', type: '病假' }],
  });
  assert.equal(leave.get('alice|2026-07-01').type, '事假');
  assert.equal(leave.get('bob|2026-07-02').type, '病假');

  const confirm = await loadConfirmMapForReconcile({
    db: mockDb(async () => ({ rows: [{ u: 'alice', d: '2026-07-03', choice: 'work' }] })),
    tid: 'default',
    start: '2026-07-01',
    end: '2026-07-03',
  });
  assert.equal(confirm.get('alice|2026-07-03').choice, 'work');
});

test('classifyAttendanceDayResult branches', () => {
  const confirmMap = new Map([['alice|2026-07-06', { choice: 'work' }]]);
  const base = {
    punch: { in: true, out: true },
    rules: DEFAULT_RULES,
    confirmMap,
    ulower: 'alice',
    d: '2026-07-01',
    uname: 'alice',
    name: 'Alice',
    st: '洪潮',
  };

  assert.equal(
    classifyAttendanceDayResult({
      ...base,
      cls: { onSchedule: false, onWeeklyRest: false },
      leave: { id: 'lv', type: '事假' },
    }).result,
    'approved_leave'
  );
  assert.equal(
    classifyAttendanceDayResult({
      ...base,
      cls: { onSchedule: false, onWeeklyRest: true },
      leave: null,
    }).result,
    'weekly_rest'
  );
  assert.equal(
    classifyAttendanceDayResult({
      ...base,
      cls: { onSchedule: true, onWeeklyRest: false },
      leave: null,
    }).result,
    'work'
  );
  assert.equal(
    classifyAttendanceDayResult({
      ...base,
      cls: { onSchedule: true, onWeeklyRest: false },
      leave: null,
      punch: { in: true, out: false },
    }).result,
    'auto_rest'
  );
  const abnormal = classifyAttendanceDayResult({
    ...base,
    d: '2026-07-05',
    cls: { onSchedule: false, onWeeklyRest: false },
    leave: null,
  });
  assert.equal(abnormal.result, 'abnormal');
  assert.ok(abnormal.abnormalEntry);

  assert.equal(
    classifyAttendanceDayResult({
      ...base,
      d: '2026-07-06',
      cls: { onSchedule: false, onWeeklyRest: false },
      leave: null,
    }).result,
    'confirmed_work'
  );
  assert.equal(
    classifyAttendanceDayResult({
      ...base,
      d: '2026-07-07',
      cls: { onSchedule: false, onWeeklyRest: false },
      leave: null,
      punch: { in: false, out: false },
    }).result,
    'unknown'
  );
});

test('upsertAttendanceDayRow / runReconcileAttendanceDaysLoop', async () => {
  const inserts = [];
  const db = mockDb(async (sql, params) => {
    if (/INSERT INTO hrms_attendance_day/i.test(sql)) {
      inserts.push(params[5]);
      return { rows: [] };
    }
    return { rows: [] };
  });

  await upsertAttendanceDayRow({
    db,
    randomUUID: () => 'id-1',
    tid: 'default',
    st: '洪潮',
    uname: 'alice',
    d: '2026-07-01',
    result: 'work',
    cls: { onSchedule: true, onWeeklyRest: false },
    punch: { in: true, out: true },
    complete: true,
    approvedLeaveId: null,
    leaveType: null,
    evidence: { onSchedule: true },
  });
  assert.deepEqual(inserts, ['work']);

  const loop = await runReconcileAttendanceDaysLoop({
    db,
    randomUUID: () => 'id-x',
    tid: 'default',
    st: '洪潮',
    people: [{ username: 'alice', name: 'Alice', joinDate: '2024-01-01' }],
    allDates: ['2026-07-01', '2026-07-02'],
    reportsByDate: new Map([
      ['2026-07-01', { front: [{ user: 'alice' }] }],
      ['2026-07-02', { restStaff: [{ user: 'alice' }] }],
    ]),
    punchMap: new Map([
      ['alice|2026-07-01', { in: true, out: true }],
      ['alice|2026-07-02', { in: false, out: false }],
    ]),
    leaveByUserDate: new Map(),
    confirmMap: new Map(),
    rules: DEFAULT_RULES,
    classifyFromDailyReportStaff,
  });
  assert.equal(loop.upserted, 2);
  assert.ok(inserts.includes('work'));
  assert.ok(inserts.includes('weekly_rest'));
});
