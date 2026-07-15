import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_ROLE_PERMISSIONS,
  legacyCanAccessAnalyticsReports,
  legacyRoleHasPermission,
  PERMISSION_CATALOG,
} from './services/hrms-permission-engine.js';

test('legacy role permissions mirror Hongchao/Majixian payroll access', () => {
  assert.equal(legacyCanAccessAnalyticsReports('hr_manager'), true);
  assert.equal(legacyCanAccessAnalyticsReports('store_manager'), true);
  assert.equal(legacyCanAccessAnalyticsReports('cashier'), false);
  assert.ok(legacyRoleHasPermission('hr_manager', 'reports.payroll.adjust'));
  assert.ok(!legacyRoleHasPermission('store_manager', 'reports.payroll.adjust'));
  assert.ok(legacyRoleHasPermission('admin', 'reports.payroll.view'));
});

test('permission catalog includes payroll sensitive items', () => {
  const ids = PERMISSION_CATALOG.map((x) => x.id);
  assert.ok(ids.includes('reports.payroll.view'));
  assert.ok(ids.includes('reports.payroll.month_run'));
  assert.ok(ids.includes('reports.leave_owed.adjust'));
});

test('legacy hr_manager has audit permission in new map', () => {
  const perms = LEGACY_ROLE_PERMISSIONS.hr_manager;
  assert.ok(perms.includes('reports.payroll.audit'));
});
