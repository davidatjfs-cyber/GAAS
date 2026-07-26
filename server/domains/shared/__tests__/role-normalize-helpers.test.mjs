import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRoleForJwt,
  normalizeUsersTableRole,
} from '../role-normalize.js';

test('normalizeRoleForJwt admin aliases', () => {
  assert.equal(normalizeRoleForJwt('admin'), 'admin');
  assert.equal(normalizeRoleForJwt('管理员'), 'admin');
  assert.equal(normalizeRoleForJwt('系统管理员'), 'admin');
  assert.equal(normalizeRoleForJwt('custom_管理员'), 'admin');
  assert.equal(normalizeRoleForJwt('custom_系统管理员'), 'admin');
});

test('normalizeRoleForJwt custom_ heuristics', () => {
  assert.equal(normalizeRoleForJwt('custom_总部营运总监'), 'hq_manager');
  assert.equal(normalizeRoleForJwt('custom_人事专员'), 'hr_manager');
  assert.equal(normalizeRoleForJwt('custom_门店店长助理'), 'store_manager');
  assert.equal(normalizeRoleForJwt('custom_出品主管'), 'store_production_manager');
  assert.equal(normalizeRoleForJwt('custom_出纳助理'), 'cashier');
  assert.equal(normalizeRoleForJwt('custom_普通店员'), 'store_employee');
});

test('normalizeRoleForJwt empty → store_employee', () => {
  assert.equal(normalizeRoleForJwt(''), 'store_employee');
  assert.equal(normalizeRoleForJwt(null), 'store_employee');
  assert.equal(normalizeRoleForJwt(undefined), 'store_employee');
  assert.equal(normalizeRoleForJwt('   '), 'store_employee');
});

test('normalizeUsersTableRole narrows cashier→store_employee', () => {
  assert.equal(normalizeUsersTableRole('cashier'), 'store_employee');
  assert.equal(normalizeUsersTableRole('出纳'), 'store_employee');
  assert.equal(normalizeUsersTableRole('hr_manager'), 'store_employee');
  assert.equal(normalizeUsersTableRole('admin'), 'admin');
  assert.equal(normalizeUsersTableRole('store_manager'), 'store_manager');
  assert.equal(normalizeUsersTableRole('hq_manager'), 'hq_manager');
  assert.equal(normalizeUsersTableRole('store_employee'), 'store_employee');
});
