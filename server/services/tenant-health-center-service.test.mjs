import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STRUCTURAL_WATCH_KEYS,
  isCsDailyActionable,
} from './tenant-health-center-service.js';

test('STRUCTURAL_WATCH_KEYS excludes phone completeness observation items', () => {
  assert.ok(STRUCTURAL_WATCH_KEYS.has('customer_phone_match_rate'));
  assert.ok(STRUCTURAL_WATCH_KEYS.has('order_phone_complete_rate'));
  assert.equal(STRUCTURAL_WATCH_KEYS.has('pos_data_connected'), false);
});

test('isCsDailyActionable excludes structural watch keys', () => {
  assert.equal(isCsDailyActionable({
    item_key: 'customer_phone_match_rate',
    owner_role: '租户管理员',
    responsible_party: 'tenant_admin',
  }), false);
});

test('isCsDailyActionable excludes system-owned integration items', () => {
  assert.equal(isCsDailyActionable({
    item_key: 'pos_data_connected',
    owner_role: '系统',
    responsible_party: 'system_integration',
  }), false);
  assert.equal(isCsDailyActionable({
    item_key: 'pos_data_connected',
    owner_role: '实施人员',
    responsible_party: 'platform_team',
  }), true);
});

test('isCsDailyActionable accepts tenant-actionable P1 items', () => {
  assert.equal(isCsDailyActionable({
    item_key: 'manager_confirmed_tasks',
    owner_role: '店长',
    responsible_party: 'store_manager',
  }), true);
});
