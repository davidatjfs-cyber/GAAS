/**
 * domains/reports/helpers.js 纯函数直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindReportsRuntimeDeps,
  normalizeEmployeeDepartureDateForTurnover,
  employeeStoreMatchesTurnoverReportFilter,
  isEmployeeDepartedForTurnoverReport,
  isEmployeeActiveLikeForTurnoverReport,
  isEmployeeCoreTalentForTurnoverReport,
  isEmployeeDepartedForPayroll,
} from '../domains/reports/helpers.js';

bindReportsRuntimeDeps({
  pool: {},
  safeMonthOnly: (m) => (/^\d{4}-\d{2}$/.test(String(m || '')) ? String(m) : ''),
  resolveAgentCanonicalStore: (s) => String(s || '').replace(/大宁/g, ''),
  getSharedState: async () => ({}),
});

test('normalizeEmployeeDepartureDateForTurnover：ISO/斜杠/中文', () => {
  assert.equal(normalizeEmployeeDepartureDateForTurnover({}), '');
  assert.equal(
    normalizeEmployeeDepartureDateForTurnover({ offboardingDate: '2026-07-01T12:00:00Z' }),
    '2026-07-01'
  );
  assert.equal(
    normalizeEmployeeDepartureDateForTurnover({ resignedAt: '2026/7/5' }),
    '2026-07-05'
  );
  assert.equal(
    normalizeEmployeeDepartureDateForTurnover({ offboardingDate: '2026年7月8日' }),
    '2026-07-08'
  );
  assert.equal(normalizeEmployeeDepartureDateForTurnover({ offboardingDate: 'bad' }), '');
});

test('employeeStoreMatchesTurnoverReportFilter：空筛选/规范对齐', () => {
  assert.equal(employeeStoreMatchesTurnoverReportFilter('A', ''), true);
  assert.equal(employeeStoreMatchesTurnoverReportFilter('', 'A'), false);
  assert.equal(
    employeeStoreMatchesTurnoverReportFilter('洪潮大宁久光店', '洪潮久光店'),
    true
  );
});

test('isEmployeeDeparted / ActiveLike / CoreTalent', () => {
  assert.equal(isEmployeeDepartedForTurnoverReport({ status: 'resigned' }), true);
  assert.equal(
    isEmployeeDepartedForTurnoverReport({ status: 'inactive', offboardingDate: '2026-07-01' }),
    true
  );
  assert.equal(isEmployeeDepartedForTurnoverReport({ status: 'inactive' }), false);
  assert.equal(
    isEmployeeDepartedForTurnoverReport({
      status: 'active',
      offboardingApproved: true,
      offboardingDate: '2026-07-01',
    }),
    true
  );

  assert.equal(isEmployeeActiveLikeForTurnoverReport({ status: 'active' }), true);
  assert.equal(
    isEmployeeActiveLikeForTurnoverReport({
      status: 'probation',
      offboardingApproved: true,
      offboardingDate: '2026-07-01',
    }),
    false
  );
  assert.equal(isEmployeeActiveLikeForTurnoverReport({ status: 'inactive' }), false);

  assert.equal(isEmployeeCoreTalentForTurnoverReport(null), false);
  assert.equal(isEmployeeCoreTalentForTurnoverReport({ coreTalent: true }), true);
  assert.equal(isEmployeeCoreTalentForTurnoverReport({ level: 'L3' }), true);
  assert.equal(isEmployeeCoreTalentForTurnoverReport({ position: '值班经理' }), true);
  assert.equal(isEmployeeCoreTalentForTurnoverReport({ role: 'store_manager' }), true);
  assert.equal(isEmployeeCoreTalentForTurnoverReport({ level: '1', role: 'cashier' }), false);
});

test('isEmployeeDepartedForPayroll：inactive 无出勤排除；有出勤保留', () => {
  assert.equal(isEmployeeDepartedForPayroll(null, '2026-07', 0), false);
  assert.equal(isEmployeeDepartedForPayroll({ status: 'active' }, '2026-07', 0), false);
  assert.equal(isEmployeeDepartedForPayroll({ status: 'inactive' }, '2026-07', 2), false);
  assert.equal(isEmployeeDepartedForPayroll({ status: '离职' }, '2026-07', 0), true);
  assert.equal(isEmployeeDepartedForPayroll({ status: 'inactive' }, 'bad', 0), false);
});
