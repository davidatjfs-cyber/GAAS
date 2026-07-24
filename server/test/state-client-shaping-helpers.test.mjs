import test from 'node:test';
import assert from 'node:assert/strict';
import {
  repairGarbledUtf8,
  deepRepairGarbledStrings,
  hrmsNormStoreName,
  hrmsIsInactiveEmploymentRecord,
  createStateClientShapingHelpers,
} from '../domains/shared/state-client-shaping.js';
import { normalizeRoleForJwt } from '../domains/shared/role-normalize.js';

test('repairGarbledUtf8 recovers latin1 mojibake of CJK', () => {
  const mojibake = Buffer.from('你好世界', 'utf8').toString('latin1');
  assert.equal(repairGarbledUtf8(mojibake), '你好世界');
});

test('repairGarbledUtf8 leaves clean ASCII unchanged', () => {
  assert.equal(repairGarbledUtf8('hello world'), 'hello world');
});

test('repairGarbledUtf8 leaves short strings unchanged', () => {
  assert.equal(repairGarbledUtf8('a'), 'a');
  assert.equal(repairGarbledUtf8(''), '');
});

test('deepRepairGarbledStrings repairs nested object/array', () => {
  const key = Buffer.from('店名', 'utf8').toString('latin1');
  const val = Buffer.from('洪潮', 'utf8').toString('latin1');
  const input = {
    [key]: val,
    nested: [{ name: Buffer.from('张三', 'utf8').toString('latin1') }],
    ok: 'ascii',
  };
  const out = deepRepairGarbledStrings(input);
  assert.equal(out['店名'], '洪潮');
  assert.equal(out.nested[0].name, '张三');
  assert.equal(out.ok, 'ascii');
});

test('hrmsNormStoreName collapses spaces', () => {
  assert.equal(hrmsNormStoreName('  洪潮  店  '), '洪潮 店');
  assert.equal(hrmsNormStoreName('A\t\tB'), 'A B');
  assert.equal(hrmsNormStoreName(null), '');
});

test('hrmsIsInactiveEmploymentRecord inactive / 离职 true; active false', () => {
  assert.equal(hrmsIsInactiveEmploymentRecord({ status: 'inactive' }), true);
  assert.equal(hrmsIsInactiveEmploymentRecord({ status: '离职' }), true);
  assert.equal(hrmsIsInactiveEmploymentRecord({ status: '停用' }), true);
  assert.equal(hrmsIsInactiveEmploymentRecord({ status: 'active' }), false);
  assert.equal(hrmsIsInactiveEmploymentRecord({ status: '在职' }), false);
  assert.equal(hrmsIsInactiveEmploymentRecord({}), false);
});

function makeShaping(overrides = {}) {
  const pool = {
    query: async () => ({ rows: [] }),
    ...overrides.pool,
  };
  const getUserStoreAccessContext =
    overrides.getUserStoreAccessContext ||
    (async () => ({ currentStore: '', allowedStores: [] }));
  return createStateClientShapingHelpers({
    normalizeRoleForJwt,
    getUserStoreAccessContext,
    pool,
  });
}

test('stripPasswordFieldsFromStateForClient admin keeps password', () => {
  const { stripPasswordFieldsFromStateForClient } = makeShaping();
  const data = {
    employees: [{ username: 'a', password: 'secret' }],
    users: [{ username: 'b', password: 'secret2' }],
  };
  const out = stripPasswordFieldsFromStateForClient(data, 'admin');
  assert.equal(out.employees[0].password, 'secret');
  assert.equal(out.users[0].password, 'secret2');
  assert.equal(out, data);
});

test('stripPasswordFieldsFromStateForClient non-admin wipes employees/users password', () => {
  const { stripPasswordFieldsFromStateForClient } = makeShaping();
  const data = {
    employees: [{ username: 'a', password: 'secret' }],
    users: [{ username: 'b', password: 'secret2' }],
    other: 'keep',
  };
  const out = stripPasswordFieldsFromStateForClient(data, 'store_manager');
  assert.equal(out.employees[0].password, '');
  assert.equal(out.users[0].password, '');
  assert.equal(out.other, 'keep');
  assert.equal(data.employees[0].password, 'secret');
});

test('applyStatePeopleVisibilityForRole admin passthrough', async () => {
  const { applyStatePeopleVisibilityForRole } = makeShaping();
  const data = {
    employees: [
      { username: 'x', store: 'A', status: '离职' },
      { username: 'y', store: 'B', status: 'active' },
    ],
    users: [],
  };
  const out = await applyStatePeopleVisibilityForRole(data, 'admin', 'admin1', data, null);
  assert.equal(out, data);
  assert.equal(out.employees.length, 2);
});

test('applyStatePeopleVisibilityForRole store_manager filters by allowedStores; keeps self; filters inactive', async () => {
  const { applyStatePeopleVisibilityForRole } = makeShaping({
    getUserStoreAccessContext: async () => ({
      currentStore: '洪潮',
      allowedStores: ['洪潮', '马己仙'],
    }),
    pool: {
      query: async () => ({ rows: [{ role: 'store_manager' }] }),
    },
  });

  const full = {
    employees: [
      { username: 'mgr', name: '店长', store: '洪潮', status: 'active', role: 'stale' },
      { username: 'a', name: 'A', store: '洪潮', status: 'active' },
      { username: 'b', name: 'B', store: '马己仙', status: 'active' },
      { username: 'c', name: 'C', store: '其他店', status: 'active' },
      { username: 'd', name: 'D', store: '洪潮', status: '离职' },
      { username: 'boss', name: '总部上级', store: '总部', status: 'active' },
    ],
    users: [
      { username: 'mgr', store: '洪潮', status: 'active', managerUsername: 'boss' },
    ],
  };

  const out = await applyStatePeopleVisibilityForRole(
    full,
    'store_manager',
    'mgr',
    full,
    '洪潮'
  );

  const empNames = out.employees.map((e) => e.username).sort();
  assert.deepEqual(empNames, ['a', 'b', 'mgr']);
  assert.equal(out.employees.find((e) => e.username === 'mgr').role, 'store_manager');
  assert.equal(out.users[0].managerName, '总部上级');
  assert.ok(!out.employees.some((e) => e.username === 'c'));
  assert.ok(!out.employees.some((e) => e.username === 'd'));
});
