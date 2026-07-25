import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ATTENDANCE_PAYROLL_RULES,
  cloneDefaultRules,
  workDaysPerMonthFromRules,
  nextMonthFirstFromDate,
  safeBizMonth,
  resolveAttendancePayrollRules,
  listAttendancePayrollRules,
} from '../services/hrms-payroll-rules.js';

test('cloneDefaultRules 深拷贝且可改', () => {
  const a = cloneDefaultRules();
  const b = cloneDefaultRules();
  a.monthlyRestDays = 9;
  assert.equal(b.monthlyRestDays, DEFAULT_ATTENDANCE_PAYROLL_RULES.monthlyRestDays);
  assert.equal(a.monthlyRestDays, 9);
});

test('workDaysPerMonthFromRules', () => {
  assert.equal(workDaysPerMonthFromRules('bad', {}), 26);
  // 2026-07 has 31 days; rest 4 → 27
  assert.equal(
    workDaysPerMonthFromRules('2026-07', {
      monthlyRestDays: 4,
      dailyRateDenominator: 'month_days_minus_rest',
    }),
    27
  );
  assert.equal(
    workDaysPerMonthFromRules('2026-02', { monthlyRestDays: -1 }),
    24 // Feb 2026 has 28; invalid rest falls back to 4
  );
});

test('nextMonthFirstFromDate', () => {
  assert.equal(nextMonthFirstFromDate('2026-07-15'), '2026-08-01');
  assert.equal(nextMonthFirstFromDate('2026-12-01'), '2027-01-01');
  const fallback = nextMonthFirstFromDate('not-a-date');
  assert.match(fallback, /^\d{4}-\d{2}-01$/);
});

test('safeBizMonth', () => {
  assert.equal(safeBizMonth('2026-07'), '2026-07');
  assert.equal(safeBizMonth('2026-07-15T00:00:00Z'), '2026-07');
  assert.equal(safeBizMonth('x'), '');
});

function mockDb(rowsBySql = {}) {
  return {
    query: async (sql) => {
      const key = Object.keys(rowsBySql).find((k) => String(sql).includes(k));
      if (key) return { rows: rowsBySql[key] };
      return { rows: [] };
    },
  };
}

test('resolveAttendancePayrollRules：默认 + store 覆盖合并', async () => {
  const db = mockDb({
    'CREATE TABLE IF NOT EXISTS': [],
    'FROM hrms_attendance_payroll_rules': [
      {
        scope_type: 'store',
        scope_key: '洪潮',
        rules_json: { monthlyRestDays: 2, pointsYuanPerPoint: 1 },
      },
      {
        scope_type: 'brand',
        scope_key: 'hongchao',
        rules_json: { payDayOfMonth: 20 },
      },
    ],
  });
  const { rules, resolvedFrom } = await resolveAttendancePayrollRules({
    tenantId: 'default',
    store: '洪潮',
    brandKey: 'hongchao',
    db,
  });
  assert.equal(rules.monthlyRestDays, 2);
  assert.equal(rules.pointsYuanPerPoint, 1);
  assert.equal(rules.payDayOfMonth, 20);
  assert.equal(resolvedFrom.usedStore, true);
  assert.equal(resolvedFrom.usedBrand, true);
  assert.equal(resolvedFrom.brand, 'hongchao');
});

test('listAttendancePayrollRules 走 mock db', async () => {
  const db = mockDb({
    'CREATE TABLE IF NOT EXISTS': [],
    'ORDER BY': [
      {
        id: 1,
        tenant_id: 'default',
        scope_type: 'tenant',
        scope_key: '',
        rules_json: { monthlyRestDays: 4 },
        active: true,
      },
    ],
  });
  const rows = await listAttendancePayrollRules('default', db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scope_type, 'tenant');
});
