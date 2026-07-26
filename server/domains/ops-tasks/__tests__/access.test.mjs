import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessOpsTasks } from '../access.js';

test('canAccessOpsTasks：允许管理/店长类角色', () => {
  for (const role of ['admin', 'hq_manager', 'hr_manager', 'store_manager', 'store_production_manager']) {
    assert.equal(canAccessOpsTasks(role), true, role);
  }
});

test('canAccessOpsTasks：拒绝员工/空/未知角色', () => {
  for (const role of ['store_employee', 'cashier', '', null, undefined, 'guest']) {
    assert.equal(canAccessOpsTasks(role), false, String(role));
  }
});
