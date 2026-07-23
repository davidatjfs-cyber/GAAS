import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATE_PUT_WHITELIST,
  STATE_PUT_SERVER_OWNED,
  applyStatePutWhitelist,
  mergeEmployeesForStatePut,
} from '../hrms-state-put.js';

test('白名单与服务端权威字段不重叠', () => {
  const overlap = STATE_PUT_WHITELIST.filter((k) => STATE_PUT_SERVER_OWNED.includes(k));
  assert.deepEqual(overlap, []);
});

test('PUT 不能覆盖 roleModules / approvalFlows / pointRecords / payrollAdjustments / employees', () => {
  const existing = {
    roleModules: { admin: ['a'] },
    approvalFlows: { leave: ['hq'] },
    paymentFlowByStore: { 门店A: ['u1'] },
    pointRecords: [{ id: 'p1', points: 10 }],
    payrollAdjustments: { '2026-07': { x: 1 } },
    employees: [{ username: 'alice', name: 'Alice' }],
    knowledge: [{ id: 'k1' }],
    examResults: [{ id: 'e1', score: 90 }],
    notifications: [{ id: 'n1', title: '旧' }],
    settings: { theme: 'old' },
  };
  const incoming = {
    roleModules: { admin: ['HACKED'] },
    approvalFlows: { leave: ['HACKED'] },
    paymentFlowByStore: { 门店A: ['HACKED'] },
    pointRecords: [{ id: 'p1', points: -999 }],
    payrollAdjustments: { '2026-07': { x: 999 } },
    employees: [{ username: 'alice', name: 'Alice2' }],
    knowledge: [{ id: 'kHACK' }],
    examResults: [{ id: 'eHACK', score: 0 }],
    notifications: [{ id: 'nHACK', title: '黑' }],
    exams: [{ id: 'dead' }],
    rewardPunishments: [{ id: 'rp' }],
    settings: { theme: 'new' },
    brandNewField: 'should-ignore',
  };
  const { next, ignoredKeys } = applyStatePutWhitelist(existing, incoming);
  assert.deepEqual(next.roleModules, { admin: ['a'] });
  assert.deepEqual(next.approvalFlows, { leave: ['hq'] });
  assert.deepEqual(next.paymentFlowByStore, { 门店A: ['u1'] });
  assert.deepEqual(next.pointRecords, [{ id: 'p1', points: 10 }]);
  assert.deepEqual(next.payrollAdjustments, { '2026-07': { x: 1 } });
  assert.equal(next.employees[0].name, 'Alice');
  assert.deepEqual(next.knowledge, [{ id: 'k1' }]);
  assert.deepEqual(next.examResults, [{ id: 'e1', score: 90 }]);
  assert.deepEqual(next.notifications, [{ id: 'n1', title: '旧' }]);
  assert.equal(next.exams, undefined);
  assert.equal(next.rewardPunishments, undefined);
  assert.equal(next.settings.theme, 'new');
  assert.equal(next.brandNewField, undefined);
  assert.ok(ignoredKeys.includes('roleModules'));
  assert.ok(ignoredKeys.includes('pointRecords'));
  assert.ok(ignoredKeys.includes('employees'));
  assert.ok(ignoredKeys.includes('knowledge'));
  assert.ok(ignoredKeys.includes('examResults'));
  assert.ok(ignoredKeys.includes('notifications'));
  assert.ok(ignoredKeys.includes('brandNewField'));
});

test('employees 合并辅助仍可用于服务端内部镜像合并', () => {
  const merged = mergeEmployeesForStatePut(
    [{ username: 'alice', name: 'A2' }],
    [
      { username: 'alice', name: 'A1', role: 'admin' },
      { username: 'bob', name: 'Bob' },
    ]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((e) => e.username === 'alice').name, 'A2');
  assert.equal(merged.find((e) => e.username === 'alice').role, 'admin');
  assert.ok(merged.some((e) => e.username === 'bob'));
});

test('stores 已移出白名单：PUT 不能覆盖经纬度等门店字段', () => {
  const existing = {
    stores: [{ name: '洪潮', latitude: 31.2, longitude: 121.5, address: '旧址' }],
  };
  const incoming = {
    stores: [{ name: '洪潮', capacity: 40 }],
  };
  const { next, ignoredKeys } = applyStatePutWhitelist(existing, incoming);
  assert.equal(next.stores[0].latitude, 31.2);
  assert.equal(next.stores[0].longitude, 121.5);
  assert.equal(next.stores[0].address, '旧址');
  assert.equal(next.stores[0].capacity, undefined);
  assert.ok(ignoredKeys.includes('stores'));
});
