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

test('PUT 不能覆盖 roleModules / approvalFlows / pointRecords / payrollAdjustments', () => {
  const existing = {
    roleModules: { admin: ['a'] },
    approvalFlows: { leave: ['hq'] },
    paymentFlowByStore: { 门店A: ['u1'] },
    pointRecords: [{ id: 'p1', points: 10 }],
    payrollAdjustments: { '2026-07': { x: 1 } },
    employees: [{ username: 'alice', name: 'Alice' }],
    settings: { theme: 'old' },
  };
  const incoming = {
    roleModules: { admin: ['HACKED'] },
    approvalFlows: { leave: ['HACKED'] },
    paymentFlowByStore: { 门店A: ['HACKED'] },
    pointRecords: [{ id: 'p1', points: -999 }],
    payrollAdjustments: { '2026-07': { x: 999 } },
    employees: [{ username: 'alice', name: 'Alice2' }],
    settings: { theme: 'new' },
    brandNewField: 'should-ignore',
  };
  const { next, ignoredKeys } = applyStatePutWhitelist(existing, incoming);
  assert.deepEqual(next.roleModules, { admin: ['a'] });
  assert.deepEqual(next.approvalFlows, { leave: ['hq'] });
  assert.deepEqual(next.paymentFlowByStore, { 门店A: ['u1'] });
  assert.deepEqual(next.pointRecords, [{ id: 'p1', points: 10 }]);
  assert.deepEqual(next.payrollAdjustments, { '2026-07': { x: 1 } });
  assert.equal(next.employees[0].name, 'Alice2');
  assert.equal(next.settings.theme, 'new');
  assert.equal(next.brandNewField, undefined);
  assert.ok(ignoredKeys.includes('roleModules'));
  assert.ok(ignoredKeys.includes('pointRecords'));
  assert.ok(ignoredKeys.includes('brandNewField'));
});

test('employees 合并：服务端独有员工不会被抹掉', () => {
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

test('stores 保留服务端经纬度', () => {
  const existing = {
    stores: [{ name: '洪潮', latitude: 31.2, longitude: 121.5, address: '旧址' }],
  };
  const incoming = {
    stores: [{ name: '洪潮', capacity: 40 }],
  };
  const { next } = applyStatePutWhitelist(existing, incoming);
  assert.equal(next.stores[0].latitude, 31.2);
  assert.equal(next.stores[0].longitude, 121.5);
  assert.equal(next.stores[0].capacity, 40);
  assert.equal(next.stores[0].address, '旧址');
});
