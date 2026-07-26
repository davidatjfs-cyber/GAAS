/**
 * payroll-legacy-build.js 纯函数直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  payrollRowKey,
  buildLegacyPointMaps,
} from '../payroll-legacy-build.js';

test('payrollRowKey: store||usernameLower', () => {
  assert.equal(payrollRowKey('洪潮店', 'alice'), '洪潮店||alice');
  assert.equal(payrollRowKey('  A  ', ' Bob '), 'A||Bob');
  assert.equal(payrollRowKey('', ''), '||');
});

test('buildLegacyPointMaps: 过滤月份 / 聚合补贴 / 记录门店', () => {
  const safeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const state0 = {
    pointRecords: [
      { username: 'alice', store: 'S1', points: 10, approvedAt: '2026-07-15T00:00:00Z' },
      { username: 'alice', store: 'S1', amount: 8, approvedAt: '2026-07-20' },
      { username: 'bob', store: 'S2', points: 4, approvedAt: '2026-06-01' },
      { username: 'carol', store: '', points: 6, createdAt: '2026-07-01' },
      { username: '', store: 'S1', points: 100, approvedAt: '2026-07-01' },
      { username: 'dave', store: 'S3', points: 0, amount: 0, approvedAt: '2026-07-01' },
    ],
  };

  const { pointStoreByUser, pointSubsidyByUserStore } = buildLegacyPointMaps(
    state0,
    '2026-07',
    safeNumber
  );

  assert.equal(pointStoreByUser.get('alice'), 'S1');
  assert.equal(pointStoreByUser.has('bob'), false);
  assert.equal(pointStoreByUser.has('carol'), false);

  assert.equal(pointSubsidyByUserStore.get('S1||alice'), 13);
  assert.equal(pointSubsidyByUserStore.get('ALL||carol'), 3);
  assert.equal(pointSubsidyByUserStore.has('S3||dave'), false);
});

test('buildLegacyPointMaps: 空 state / 无记录', () => {
  const safeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const { pointStoreByUser, pointSubsidyByUserStore } = buildLegacyPointMaps({}, '2026-07', safeNumber);
  assert.equal(pointStoreByUser.size, 0);
  assert.equal(pointSubsidyByUserStore.size, 0);
});
