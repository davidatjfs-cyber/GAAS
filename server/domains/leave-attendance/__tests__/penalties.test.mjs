/**
 * domains/leave-attendance/penalties.js 缺卡扣假计算（mock pool）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTENDANCE_PENALTY_START_DATE,
  createPenaltiesHelpers,
} from '../penalties.js';

test('ATTENDANCE_PENALTY_START_DATE 冻结', () => {
  assert.equal(ATTENDANCE_PENALTY_START_DATE, '2026-06-01');
});

test('computeAttendanceMissingClockPenalties：坏月份→空 Map', async () => {
  const { computeAttendanceMissingClockPenalties } = createPenaltiesHelpers({
    pool: { query: async () => ({ rows: [] }) },
    safeMonthOnly: () => '',
  });
  const out = await computeAttendanceMissingClockPenalties('bad', '', 'default');
  assert.equal(out.size, 0);
});

test('computeAttendanceMissingClockPenalties：早于起始日整月→空', async () => {
  const { computeAttendanceMissingClockPenalties } = createPenaltiesHelpers({
    pool: { query: async () => ({ rows: [{ u: 'a', d: '2026-05-01' }] }) },
    safeMonthOnly: (m) => m,
  });
  const out = await computeAttendanceMissingClockPenalties('2026-05', '店A', 'default');
  assert.equal(out.size, 0);
});

test('computeAttendanceMissingClockPenalties：齐全不扣；缺卡/无卡扣 1 天', async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/daily_report_attendance_register/i.test(sql)) {
        return {
          rows: [
            { u: 'alice', d: '2026-07-01' },
            { u: 'bob', d: '2026-07-01' },
            { u: 'carol', d: '2026-07-02' },
          ],
        };
      }
      if (/checkin_records/i.test(sql)) {
        return {
          rows: [
            { u: 'alice', d: '2026-07-01', has_in: true, has_out: true },
            { u: 'bob', d: '2026-07-01', has_in: true, has_out: false },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const { computeAttendanceMissingClockPenalties } = createPenaltiesHelpers({
    pool,
    safeMonthOnly: (m) => m,
  });
  const out = await computeAttendanceMissingClockPenalties('2026-07', '测试店', 'default');
  assert.equal(out.has('alice'), false);
  assert.equal(out.get('bob')?.days, 1);
  assert.match(out.get('bob')?.details[0].source, /缺下班卡/);
  assert.equal(out.get('carol')?.days, 1);
  assert.match(out.get('carol')?.details[0].source, /无打卡/);
  assert.ok(queries[0].sql.includes('TRIM(store)'));
  assert.ok(queries[0].params.includes('测试店'));
});

test('computeAttendanceMissingClockPenalties：无出勤行 / DB 错误 → 空', async () => {
  const empty = createPenaltiesHelpers({
    pool: {
      query: async (sql) => {
        if (/daily_report_attendance_register/i.test(sql)) return { rows: [] };
        return { rows: [] };
      },
    },
    safeMonthOnly: (m) => m,
  });
  assert.equal((await empty.computeAttendanceMissingClockPenalties('2026-07', '', 'default')).size, 0);

  const boom = createPenaltiesHelpers({
    pool: {
      query: async () => {
        throw new Error('db');
      },
    },
    safeMonthOnly: (m) => m,
  });
  assert.equal((await boom.computeAttendanceMissingClockPenalties('2026-07', '', 'default')).size, 0);
});
