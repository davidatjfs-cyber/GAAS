import test from 'node:test';
import assert from 'node:assert/strict';
import { createPickUsernameHelpers } from '../domains/employees/pick-usernames.js';

function makeHelpers(pool) {
  return createPickUsernameHelpers({
    pool,
    resolveTenantIdDefault: () => 'default',
  });
}

test('pickAdminUsername prefers employees state', async () => {
  let queryCalls = 0;
  const { pickAdminUsername } = makeHelpers({
    query: async () => {
      queryCalls += 1;
      return { rows: [{ username: 'db_admin' }] };
    },
  });
  const got = await pickAdminUsername({
    employees: [{ role: 'admin', username: 'emp_admin' }],
    users: [{ role: 'admin', username: 'user_admin' }],
  });
  assert.equal(got, 'emp_admin');
  assert.equal(queryCalls, 0);
});

test('pickAdminUsername falls back to DB with tenant_id filter', async () => {
  let lastSql = '';
  let lastParams = null;
  const { pickAdminUsername } = makeHelpers({
    query: async (sql, params) => {
      lastSql = sql;
      lastParams = params;
      return { rows: [{ username: 'db_admin' }] };
    },
  });
  const got = await pickAdminUsername({ employees: [], users: [] });
  assert.equal(got, 'db_admin');
  assert.match(lastSql, /tenant_id\s*=\s*\$1/);
  assert.deepEqual(lastParams, ['default']);
});

test('pickAdminUsername final fallback is admin', async () => {
  const { pickAdminUsername } = makeHelpers({
    query: async () => ({ rows: [] }),
  });
  assert.equal(await pickAdminUsername({}), 'admin');
});

test('pickHqManagerUsername skips 离职/inactive and returns empty when none', async () => {
  let queryCalls = 0;
  const { pickHqManagerUsername } = makeHelpers({
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
  });
  const got = await pickHqManagerUsername({
    employees: [
      { role: 'hq_manager', username: 'gone', status: '离职' },
      { role: 'hq_manager', username: 'off', status: 'inactive' },
    ],
  });
  assert.equal(got, '');
  assert.equal(queryCalls, 1);
});

test('pickHrManagerUsername resolves custom_人事经理 without pool call', async () => {
  let queryCalls = 0;
  const { pickHrManagerUsername } = makeHelpers({
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
  });
  const got = await pickHrManagerUsername({
    employees: [{ role: 'custom_人事经理', username: 'hr_custom', status: '在职' }],
  });
  assert.equal(got, 'hr_custom');
  assert.equal(queryCalls, 0);
});

test('pickCashierUsername hits state first; DB query has no tenant_id', async () => {
  let queryCalls = 0;
  let lastSql = '';
  const { pickCashierUsername } = makeHelpers({
    query: async (sql) => {
      queryCalls += 1;
      lastSql = sql;
      return { rows: [{ username: 'db_cashier' }] };
    },
  });

  const fromState = await pickCashierUsername({
    employees: [{ role: 'custom_出纳', username: 'state_cashier', status: '在职' }],
  });
  assert.equal(fromState, 'state_cashier');
  assert.equal(queryCalls, 0);

  const fromDb = await pickCashierUsername({ employees: [], users: [] });
  assert.equal(fromDb, 'db_cashier');
  assert.equal(queryCalls, 1);
  assert.doesNotMatch(lastSql, /tenant_id/);
});

test('pickStoreRoleUsernameByStore matches role/store', () => {
  const { pickStoreRoleUsernameByStore } = makeHelpers({ query: async () => ({ rows: [] }) });
  const got = pickStoreRoleUsernameByStore(
    {
      employees: [
        { store: '洪潮店', role: 'store_manager', username: 'mgr1', status: '在职' },
        { store: '别的店', role: 'store_manager', username: 'mgr2', status: '在职' },
      ],
    },
    '洪潮店',
    ['store_manager']
  );
  assert.equal(got, 'mgr1');
});

test('pickStoreRoleUsernameByStore production_manager prefers 出品经理/厨师长', () => {
  const { pickStoreRoleUsernameByStore } = makeHelpers({ query: async () => ({ rows: [] }) });
  const got = pickStoreRoleUsernameByStore(
    {
      employees: [
        { store: '洪潮店', role: 'store_production_manager', username: 'cook1', position: '炒锅', status: '在职' },
        { store: '洪潮店', role: 'store_production_manager', username: 'chef', position: '出品经理', status: '在职' },
      ],
    },
    '洪潮店',
    ['store_production_manager']
  );
  assert.equal(got, 'chef');
});

test('pickStoreRoleUsernameByStore skips line-cook titles when alternatives exist', () => {
  const { pickStoreRoleUsernameByStore } = makeHelpers({ query: async () => ({ rows: [] }) });
  const got = pickStoreRoleUsernameByStore(
    {
      employees: [
        { store: '洪潮店', role: 'store_production_manager', username: 'line', position: '砧板', status: '在职' },
        { store: '洪潮店', role: 'store_production_manager', username: 'lead', position: '后厨主管', status: '在职' },
      ],
    },
    '洪潮店',
    ['store_production_manager']
  );
  assert.equal(got, 'lead');
});

test('pickStoreRoleUsernameByStore returns empty on bad input', () => {
  const { pickStoreRoleUsernameByStore } = makeHelpers({ query: async () => ({ rows: [] }) });
  assert.equal(pickStoreRoleUsernameByStore({}, '', ['store_manager']), '');
  assert.equal(pickStoreRoleUsernameByStore({}, '洪潮店', []), '');
  assert.equal(pickStoreRoleUsernameByStore({}, '洪潮店', null), '');
});
