/**
 * L1：考勤日结果 API — confirm / list / summarize / rest / notify（mock db）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  confirmAttendanceDayAbnormal,
  listAbnormalAttendanceDays,
  summarizeAttendanceDaysForMonth,
  listAttendanceRestDaysForMonth,
  notifyStoreManagersAttendanceAbnormals,
  reconcileAttendanceDays,
} from '../../../services/hrms-attendance-day.js';

function mockDb(handler) {
  return {
    async query(sql, params) {
      return handler(String(sql), params || []);
    },
  };
}

test('confirmAttendanceDayAbnormal：参数校验 / 成功 / 未找到', async () => {
  assert.deepEqual(
    await confirmAttendanceDayAbnormal({ username: '', workDate: '2026-07-01', choice: 'work', db: mockDb(async () => ({ rows: [] })) }),
    { ok: false, error: 'invalid_params' }
  );
  assert.deepEqual(
    await confirmAttendanceDayAbnormal({
      username: 'u1',
      workDate: '2026-07-01',
      choice: 'maybe',
      db: mockDb(async () => ({ rows: [] })),
    }),
    { ok: false, error: 'invalid_params' }
  );

  const db = mockDb(async (sql) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/UPDATE hrms_attendance_day/i.test(sql)) {
      return { rows: [{ id: 'day-1', store: '洪潮', username: 'u1', work_date: '2026-07-01', result: 'confirmed_work' }] };
    }
    if (/INSERT INTO hrms_attendance_day_confirmations/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });
  const ok = await confirmAttendanceDayAbnormal({
    username: 'u1',
    workDate: '2026-07-01',
    choice: 'work',
    confirmedBy: 'mgr',
    note: '确认出勤',
    db,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.result, 'confirmed_work');

  const miss = await confirmAttendanceDayAbnormal({
    username: 'u1',
    workDate: '2026-07-02',
    choice: 'rest',
    db: mockDb(async (sql) => {
      if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
      if (/UPDATE/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
  });
  assert.equal(miss.error, 'not_found_or_locked');
});

test('listAbnormalAttendanceDays / summarizeAttendanceDaysForMonth', async () => {
  const rows = await listAbnormalAttendanceDays({
    store: '洪潮',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    db: mockDb(async (sql, params) => {
      assert.match(sql, /result = 'abnormal'/);
      assert.ok(params.includes('洪潮'));
      return { rows: [{ id: 1, username: 'u1', result: 'abnormal' }] };
    }),
  });
  assert.equal(rows.length, 1);

  assert.equal(await summarizeAttendanceDaysForMonth({ username: '', month: '2026-07', db: mockDb(async () => ({ rows: [] })) }), null);
  const sum = await summarizeAttendanceDaysForMonth({
    username: 'alice',
    month: '2026-07',
    db: mockDb(async () => ({
      rows: [
        { result: 'work', c: 20 },
        { result: 'confirmed_work', c: 1 },
        { result: 'weekly_rest', c: 3 },
        { result: 'auto_rest', c: 1 },
        { result: 'abnormal', c: 2 },
      ],
    })),
  });
  assert.equal(sum.workDays, 21);
  assert.equal(sum.restDays, 4);
  assert.equal(sum.abnormalDays, 2);
});

test('listAttendanceRestDaysForMonth：明细类型 + 查询失败', async () => {
  assert.deepEqual(
    await listAttendanceRestDaysForMonth({ username: 'x', month: 'bad', db: mockDb(async () => ({ rows: [] })) }),
    []
  );
  const days = await listAttendanceRestDaysForMonth({
    username: 'alice',
    month: '2026-07',
    db: mockDb(async () => ({
      rows: [
        { d: '2026-07-03', result: 'weekly_rest', leave_type: null },
        { d: '2026-07-10', result: 'approved_leave', leave_type: '事假' },
        { d: '2026-07-11', result: 'approved_leave', leave_type: 'leave' },
        { d: 'bad', result: 'auto_rest', leave_type: null },
      ],
    })),
  });
  assert.equal(days.length, 3);
  assert.equal(days[0].type, '休息');
  assert.equal(days[1].type, '事假');
  assert.equal(days[2].type, '休假');

  const empty = await listAttendanceRestDaysForMonth({
    username: 'alice',
    month: '2026-07',
    db: mockDb(async () => {
      throw new Error('db_down');
    }),
  });
  assert.deepEqual(empty, []);
});

test('reconcileAttendanceDays：多规则分类 + upsert', async () => {
  const inserts = [];
  const db = mockDb(async (sql, params) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/FROM hrms_attendance_payroll_rules/i.test(sql)) return { rows: [] };
    if (/daily_report_attendance_register/i.test(sql)) {
      return {
        rows: [{
          d: '2026-07-05',
          staff_snapshot: JSON.stringify({ front: [{ user: 'alice' }] }),
        }],
      };
    }
    if (/FROM checkin_records/i.test(sql)) {
      return {
        rows: [
          { u: 'alice', d: '2026-07-03', type: 'clock_in', c: 1 },
          { u: 'alice', d: '2026-07-03', type: 'clock_out', c: 1 },
          { u: 'alice', d: '2026-07-04', type: 'clock_in', c: 1 }, // incomplete
          { u: 'alice', d: '2026-07-05', type: 'clock_in', c: 1 },
          { u: 'alice', d: '2026-07-05', type: 'clock_out', c: 1 },
          { u: 'alice', d: '2026-07-06', type: 'clock_in', c: 1 },
          { u: 'alice', d: '2026-07-06', type: 'clock_out', c: 1 },
        ],
      };
    }
    if (/FROM hrms_leave_records/i.test(sql)) {
      return {
        rows: [{ id: 'lv1', u: 'alice', sd: '2026-07-01', ed: '2026-07-01', type: '事假' }],
      };
    }
    if (/FROM hrms_attendance_day_confirmations/i.test(sql)) {
      return {
        rows: [{ u: 'alice', d: '2026-07-06', choice: 'work', confirmed_by: 'mgr' }],
      };
    }
    if (/INSERT INTO hrms_attendance_day/i.test(sql)) {
      inserts.push(params[5]); // result
      return { rows: [] };
    }
    if (/FROM employees|SELECT username, name, store/i.test(sql)) return { rows: [] };
    return { rows: [] };
  });

  const r = await reconcileAttendanceDays({
    tenantId: 'default',
    store: '洪潮',
    startDate: '2026-07-01',
    endDate: '2026-07-06',
    db,
    getSharedState: async () => ({
      employees: [{ username: 'alice', name: 'Alice', store: '洪潮', status: '在职', joinDate: '2024-01-01' }],
      dailyReports: [
        {
          date: '2026-07-02',
          store: '洪潮',
          data: { staff: { restStaff: [{ user: 'alice' }] } },
        },
        {
          date: '2026-07-03',
          store: '洪潮',
          data: { staff: { front: [{ user: 'alice' }] } },
        },
        {
          date: '2026-07-04',
          store: '洪潮',
          data: { staff: { front: [{ user: 'alice' }] } },
        },
      ],
    }),
  });
  assert.equal(r.ok, true);
  assert.ok(r.upserted >= 5);
  assert.ok(inserts.includes('approved_leave'));
  assert.ok(inserts.includes('weekly_rest'));
  assert.ok(inserts.includes('work'));
  assert.ok(inserts.includes('auto_rest'));
  assert.ok(inserts.includes('confirmed_work') || inserts.includes('abnormal'));
});

test('reconcileAttendanceDays：无确认 abnormal + state leaveRecords 兜底', async () => {
  const inserts = [];
  const db = mockDb(async (sql, params) => {
    if (/CREATE TABLE/i.test(sql) || /CREATE INDEX/i.test(sql)) return { rows: [] };
    if (/FROM hrms_attendance_payroll_rules/i.test(sql)) return { rows: [] };
    if (/FROM checkin_records/i.test(sql)) {
      return {
        rows: [
          { u: 'bob', d: '2026-07-10', type: 'clock_in', c: 1 },
          { u: 'bob', d: '2026-07-10', type: 'clock_out', c: 1 },
          { u: 'bob', d: '2026-07-11', type: 'clock_in', c: 1 },
          { u: 'bob', d: '2026-07-11', type: 'clock_out', c: 1 },
        ],
      };
    }
    if (/FROM hrms_leave_records/i.test(sql)) throw new Error('leave_table_missing');
    if (/daily_report_attendance_register/i.test(sql)) return { rows: [] };
    if (/FROM hrms_attendance_day_confirmations/i.test(sql)) return { rows: [] };
    if (/INSERT INTO hrms_attendance_day/i.test(sql)) {
      inserts.push(params[5]);
      return { rows: [] };
    }
    return { rows: [] };
  });

  const r = await reconcileAttendanceDays({
    store: '洪潮',
    startDate: '2026-07-10',
    endDate: '2026-07-11',
    db,
    getSharedState: async () => ({
      employees: [{ username: 'bob', name: 'Bob', store: '洪潮', status: 'active', joinDate: '2024-01-01' }],
      dailyReports: [],
      leaveRecords: [
        {
          applicant: 'bob',
          username: 'bob',
          status: 'approved',
          startDate: '2026-07-11',
          endDate: '2026-07-11',
          type: '病假',
          id: 'st-lv',
        },
      ],
    }),
  });
  assert.equal(r.ok, true);
  assert.ok(inserts.includes('abnormal')); // 7/10 无排班有打卡无确认
  assert.ok(inserts.includes('approved_leave')); // 7/11 state leave
  assert.ok(r.abnormalCount >= 1);
});

test('notifyStoreManagersAttendanceAbnormals', async () => {
  assert.equal(await notifyStoreManagersAttendanceAbnormals({ abnormals: [] }), 0);
  assert.equal(
    await notifyStoreManagersAttendanceAbnormals({
      abnormals: [{ store: '洪潮', username: 'u1', work_date: '2026-07-01' }],
    }),
    0
  );

  const notifs = [];
  const n = await notifyStoreManagersAttendanceAbnormals({
    abnormals: [
      { store: '洪潮', username: 'u1', name: '甲', work_date: '2026-07-01' },
      { store: '洪潮', username: 'u2', name: '乙', work_date: '2026-07-02' },
      { store: '马己仙', username: 'u3', name: '丙', work_date: '2026-07-03' },
    ],
    makeNotif: (u, title, msg, meta) => ({ u, title, msg, meta }),
    appendNotifications: async (items) => {
      notifs.push(...items);
    },
    getSharedState: async () => ({
      employees: [
        { username: 'mgr1', role: 'store_manager', store: '洪潮' },
        { username: 'mgr2', role: 'store_manager', store: '马己仙店' },
        { username: 'emp', role: 'employee', store: '洪潮' },
      ],
    }),
  });
  assert.equal(n, 2);
  assert.equal(notifs.length, 2);
  assert.ok(notifs.every((x) => x.title === '考勤异常待确认'));
});
