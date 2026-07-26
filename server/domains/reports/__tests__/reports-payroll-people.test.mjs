/**
 * payroll-people.js — buildPayrollPeopleMaps 单测（mock ctx，无 DB）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollPeopleMaps } from '../payroll-people.js';

function makeCtx(overrides = {}) {
  return {
    dbListEmployeesForReports: overrides.dbListEmployeesForReports || (async () => []),
    isLegacyTestUsername: (u) => String(u || '').toLowerCase().startsWith('test_'),
    ...overrides,
  };
}

test('buildPayrollPeopleMaps: state employees + users 去重与大小写', async () => {
  const state0 = {
    employees: [
      { username: 'Alice', name: '爱丽丝', store: 'S1' },
      { username: 'test_bot', name: '测试', store: 'S1' },
    ],
    users: [
      { username: 'bob', name: '鲍勃', store: 'S2' },
      { username: 'alice', name: '重复', store: 'S9' },
    ],
  };

  const maps = await buildPayrollPeopleMaps(makeCtx(), state0, '', 'default');

  assert.equal(maps.peopleByLower.size, 2);
  assert.equal(maps.peopleByLower.get('alice')?.username, 'Alice');
  assert.equal(maps.peopleByLower.get('bob')?.name, '鲍勃');
  assert.ok(maps.knownUsers.has('alice'));
  assert.ok(maps.knownUsers.has('bob'));
  assert.equal(maps.canonicalUsernameByLower.get('alice'), 'Alice');
  assert.equal(maps.allPeople.length, 2);
  assert.equal(maps.people.length, 2);
});

test('buildPayrollPeopleMaps: 按 store 过滤', async () => {
  const state0 = {
    employees: [
      { username: 'a1', store: '洪潮店' },
      { username: 'a2', store: '马己仙店' },
    ],
  };

  const maps = await buildPayrollPeopleMaps(makeCtx(), state0, '洪潮店', 'default');

  assert.equal(maps.people.length, 1);
  assert.equal(maps.people[0].username, 'a1');
  assert.equal(maps.allPeople.length, 2);
});

test('buildPayrollPeopleMaps: state 空时回落 DB', async () => {
  const dbEmployees = [
    { username: 'db1', name: 'DB一', store: 'S1' },
    { username: 'test_legacy', name: '跳过', store: 'S1' },
  ];
  const ctx = makeCtx({
    dbListEmployeesForReports: async ({ store, includeInactive, tenantId }) => {
      assert.equal(store, 'S1');
      assert.equal(includeInactive, false);
      assert.equal(tenantId, 't1');
      return dbEmployees;
    },
  });

  const maps = await buildPayrollPeopleMaps(ctx, { employees: [], users: [] }, 'S1', 't1');

  assert.equal(maps.peopleByLower.size, 1);
  assert.equal(maps.peopleByLower.get('db1')?.name, 'DB一');
  assert.equal(maps.people.length, 1);
});

test('buildPayrollPeopleMaps: state 有数据时不查 DB', async () => {
  let dbCalled = false;
  const ctx = makeCtx({
    dbListEmployeesForReports: async () => {
      dbCalled = true;
      return [{ username: 'db1', store: 'S1' }];
    },
  });
  const state0 = { employees: [{ username: 'local', store: 'S1' }] };

  const maps = await buildPayrollPeopleMaps(ctx, state0, '', 'default');

  assert.equal(dbCalled, false);
  assert.equal(maps.peopleByLower.size, 1);
  assert.equal(maps.peopleByLower.get('local')?.username, 'local');
});
