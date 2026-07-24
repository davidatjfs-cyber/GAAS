import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoleAccessHelpers } from '../domains/shared/role-access.js';

function makeHelpers(normalizeRoleForJwt) {
  return createRoleAccessHelpers({
    normalizeRoleForJwt:
      normalizeRoleForJwt ||
      ((role) => {
        const v = String(role || '').trim();
        if (v === '管理员') return 'admin';
        return v || 'store_employee';
      }),
  });
}

test('isAdmin positive/negative', () => {
  const { isAdmin } = makeHelpers();
  assert.equal(isAdmin('admin'), true);
  assert.equal(isAdmin(' admin '), true);
  assert.equal(isAdmin('hq_manager'), false);
  assert.equal(isAdmin('管理员'), false);
  assert.equal(isAdmin(''), false);
  assert.equal(isAdmin(null), false);
});

test('isHq positive/negative', () => {
  const { isHq } = makeHelpers();
  assert.equal(isHq('hq_manager'), true);
  assert.equal(isHq('hr_manager'), true);
  assert.equal(isHq('admin'), false);
  assert.equal(isHq('store_manager'), false);
  assert.equal(isHq(''), false);
});

test('canAccessAnalyticsReports positive/negative', () => {
  const { canAccessAnalyticsReports } = makeHelpers();
  for (const role of ['admin', 'hq_manager', 'store_manager', 'hr_manager', 'store_production_manager']) {
    assert.equal(canAccessAnalyticsReports(role), true, role);
  }
  assert.equal(canAccessAnalyticsReports('store_employee'), false);
  assert.equal(canAccessAnalyticsReports('cashier'), false);
  assert.equal(canAccessAnalyticsReports(''), false);
});

test('canAccessBusinessReports positive/negative', () => {
  const { canAccessBusinessReports } = makeHelpers();
  for (const role of ['admin', 'hq_manager', 'store_manager']) {
    assert.equal(canAccessBusinessReports(role), true, role);
  }
  assert.equal(canAccessBusinessReports('hr_manager'), false);
  assert.equal(canAccessBusinessReports('store_production_manager'), false);
  assert.equal(canAccessBusinessReports('store_employee'), false);
});

test('canAccessDailyAttendanceRegister calls normalizeRoleForJwt (管理员→admin)', () => {
  const calls = [];
  const { canAccessDailyAttendanceRegister } = makeHelpers((role) => {
    calls.push(role);
    const v = String(role || '').trim();
    if (v === '管理员') return 'admin';
    if (v === '总部营运') return 'hq_manager';
    if (v === '总部人事') return 'hr_manager';
    return v || 'store_employee';
  });

  assert.equal(canAccessDailyAttendanceRegister('管理员'), true);
  assert.equal(canAccessDailyAttendanceRegister('总部营运'), true);
  assert.equal(canAccessDailyAttendanceRegister('总部人事'), true);
  assert.equal(canAccessDailyAttendanceRegister('admin'), true);
  assert.equal(canAccessDailyAttendanceRegister('hq_manager'), true);
  assert.equal(canAccessDailyAttendanceRegister('hr_manager'), true);
  assert.equal(canAccessDailyAttendanceRegister('store_manager'), false);
  assert.equal(canAccessDailyAttendanceRegister('store_employee'), false);

  assert.ok(calls.includes('管理员'));
  assert.ok(calls.includes('总部营运'));
  assert.ok(calls.includes('store_manager'));
});
