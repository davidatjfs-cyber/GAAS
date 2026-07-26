import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserLookupHelpers } from '../user-lookup.js';

function makeHelpers({ pool, expandAgentStoreLabels } = {}) {
  return createUserLookupHelpers({
    pool: pool || { query: async () => ({ rows: [] }) },
    expandAgentStoreLabels: expandAgentStoreLabels || ((s) => [s]),
  });
}

test('stateFindUserRecord returns null for empty username / empty state', () => {
  const { stateFindUserRecord } = makeHelpers();
  assert.equal(stateFindUserRecord({}, ''), null);
  assert.equal(stateFindUserRecord({}, '   '), null);
  assert.equal(stateFindUserRecord({}, 'alice'), null);
  assert.equal(stateFindUserRecord(null, 'alice'), null);
  assert.equal(stateFindUserRecord({ employees: [{ store: '无用户名' }] }, 'alice'), null);
});

test('stateFindUserRecord: users-only; non-array lists; trims username input', () => {
  const { stateFindUserRecord } = makeHelpers();
  const fromUsers = stateFindUserRecord(
    { users: [{ username: 'legacy', store: 'U店', role: 'admin' }] },
    '  LEGACY  '
  );
  assert.equal(fromUsers?.store, 'U店');
  assert.equal(fromUsers?.role, 'admin');

  assert.strictEqual(
    stateFindUserRecord({ employees: 'bad', users: 'bad' }, 'nobody'),
    null
  );
  assert.equal(
    stateFindUserRecord({ employees: [{ username: 'only-emp', store: 'E1' }] }, 'only-emp')?.store,
    'E1'
  );

  const padded = stateFindUserRecord(
    { employees: [null, { username: '  zed  ', store: 'Z1' }] },
    'zed'
  );
  assert.equal(padded?.store, 'Z1');

  assert.strictEqual(
    stateFindUserRecord({ employees: [{ username: '   ', store: 'X' }] }, 'alice'),
    null
  );
  assert.strictEqual(stateFindUserRecord({ employees: [] }, null), null);
  assert.strictEqual(stateFindUserRecord({ employees: [] }, undefined), null);

  assert.strictEqual(
    stateFindUserRecord({ employees: [{ store: 'orphan' }] }, 'Stryker'),
    null
  );
  assert.strictEqual(
    stateFindUserRecord({ employees: [{ store: 'orphan' }] }, 'Stryker was here!'),
    null
  );

  assert.strictEqual(
    stateFindUserRecord({ employees: [{ username: 'Stryker was here!', store: 'trap' }] }, null),
    null
  );
});

test('stateFindUserRecord prefers employees over users; case-insensitive', () => {
  const { stateFindUserRecord } = makeHelpers();
  const state = {
    employees: [{ username: 'Alice', store: '洪潮店', role: 'store_manager' }],
    users: [{ username: 'alice', store: '马己仙', role: 'admin' }],
  };
  const got = stateFindUserRecord(state, 'ALICE');
  assert.equal(got?.store, '洪潮店');
  assert.equal(got?.role, 'store_manager');
});

test('dbFindEmployeeRecord maps level from extra_json; null on miss/error; SQL has no tenant_id', async () => {
  let lastSql = '';
  let lastParams = null;
  const { dbFindEmployeeRecord } = makeHelpers({
    pool: {
      query: async (sql, params) => {
        lastSql = sql;
        lastParams = params;
        return {
          rows: [{
            username: 'bob',
            name: 'Bob',
            role: 'store_manager',
            store: '洪潮店',
            department: null,
            position: null,
            status: '在职',
            joinDate: null,
            createdAt: null,
            extraJson: { level: 'L3' },
          }],
        };
      },
    },
  });

  const got = await dbFindEmployeeRecord('Bob');
  assert.equal(got?.username, 'bob');
  assert.equal(got?.level, 'L3');
  assert.doesNotMatch(lastSql, /tenant_id/);
  assert.deepEqual(lastParams, ['Bob']);

  const trimUser = makeHelpers({
    pool: {
      query: async (_sql, params) => {
        assert.deepEqual(params, ['bob']);
        return { rows: [] };
      },
    },
  });
  assert.strictEqual(await trimUser.dbFindEmployeeRecord('  bob  '), null);

  const miss = makeHelpers({
    pool: { query: async () => ({ rows: [] }) },
  });
  assert.equal(await miss.dbFindEmployeeRecord('nobody'), null);

  const err = makeHelpers({
    pool: {
      query: async () => {
        throw new Error('db_down');
      },
    },
  });
  assert.equal(await err.dbFindEmployeeRecord('bob'), null);
  assert.equal(await err.dbFindEmployeeRecord(''), null);
  assert.equal(await err.dbFindEmployeeRecord('   '), null);

  let queryCalls = 0;
  const noEarly = makeHelpers({
    pool: {
      query: async () => {
        queryCalls += 1;
        return { rows: [{ username: 'Stryker was here!', name: 'Trap', role: 'r', store: 's', department: null, position: null, status: '在职', joinDate: null, createdAt: null, extraJson: {} }] };
      },
    },
  });
  assert.strictEqual(await noEarly.dbFindEmployeeRecord(null), null);
  assert.equal(queryCalls, 0);
});

test('dbFindEmployeeRecord: level fallback chain; extraJson guard; rows shape; SQL fragments', async () => {
  let lastSql = '';
  const cases = [
    {
      label: 'extra level wins over row.level',
      row: {
        username: 'a',
        name: 'A',
        role: 'r',
        store: 's',
        department: null,
        position: null,
        status: '在职',
        joinDate: null,
        createdAt: null,
        level: 'ROW',
        extraJson: { level: '  L9  ' },
      },
      expectLevel: 'L9',
    },
    {
      label: 'rest.level when extra empty',
      row: {
        username: 'b',
        name: 'B',
        role: 'r',
        store: 's',
        department: null,
        position: null,
        status: '在职',
        joinDate: null,
        createdAt: null,
        level: ' ROW2 ',
        extraJson: { level: '' },
      },
      expectLevel: 'ROW2',
    },
    {
      label: 'empty level when both missing',
      row: {
        username: 'c',
        name: 'C',
        role: 'r',
        store: 's',
        department: null,
        position: null,
        status: '在职',
        joinDate: null,
        createdAt: null,
        extraJson: null,
      },
      expectLevel: '',
    },
    {
      label: 'non-object extraJson → {}',
      row: {
        username: 'd',
        name: 'D',
        role: 'r',
        store: 's',
        department: null,
        position: null,
        status: '在职',
        joinDate: null,
        createdAt: null,
        extraJson: 'bad',
        level: 'FALL',
      },
      expectLevel: 'FALL',
    },
  ];

  for (const c of cases) {
    const { dbFindEmployeeRecord } = makeHelpers({
      pool: {
        query: async (sql) => {
          lastSql = sql;
          return { rows: [c.row] };
        },
      },
    });
    const got = await dbFindEmployeeRecord(c.row.username);
    assert.equal(got?.level, c.expectLevel, c.label);
  }

  const noRows = makeHelpers({
    pool: { query: async () => ({ rows: undefined }) },
  });
  assert.equal(await noRows.dbFindEmployeeRecord('ghost'), null);

  assert.match(lastSql, /from employees/i);
  assert.match(lastSql, /lower\(username\)\s*=\s*lower\(\$1\)/i);
  assert.match(lastSql, /limit 1/i);
  assert.match(lastSql, /coalesce\(extra_json/i);

  const nullRow = makeHelpers({
    pool: { query: async () => ({ rows: [null] }) },
  });
  assert.strictEqual(await nullRow.dbFindEmployeeRecord('n'), null);

  const numericExtra = makeHelpers({
    pool: {
      query: async () => ({
        rows: [{
          username: 'num',
          name: 'N',
          role: 'r',
          store: 's',
          department: null,
          position: null,
          status: '在职',
          joinDate: null,
          createdAt: null,
          extraJson: 42,
          level: 'ROW-L',
        }],
      }),
    },
  });
  assert.equal((await numericExtra.dbFindEmployeeRecord('num'))?.level, 'ROW-L');

  const zeroLevel = makeHelpers({
    pool: {
      query: async () => ({
        rows: [{
          username: 'zero',
          name: 'Z',
          role: 'r',
          store: 's',
          department: null,
          position: null,
          status: '在职',
          joinDate: null,
          createdAt: null,
          extraJson: { level: 0 },
        }],
      }),
    },
  });
  assert.equal((await zeroLevel.dbFindEmployeeRecord('zero'))?.level, '0');

  const numericUsername = makeHelpers({
    pool: {
      query: async (_sql, params) => {
        assert.deepEqual(params, ['12345']);
        return { rows: [] };
      },
    },
  });
  assert.strictEqual(await numericUsername.dbFindEmployeeRecord(12345), null);

  const missingRows = makeHelpers({
    pool: { query: async () => ({}) },
  });
  assert.strictEqual(await missingRows.dbFindEmployeeRecord('x'), null);

  const emptyRow = makeHelpers({
    pool: { query: async () => ({ rows: [{}] }) },
  });
  const sparse = await emptyRow.dbFindEmployeeRecord('sparse');
  assert.equal(typeof sparse, 'object');
  assert.equal(sparse?.username, undefined);
  assert.equal(sparse?.level, '');

  const arrayExtra = makeHelpers({
    pool: {
      query: async () => ({
        rows: [{
          username: 'arr',
          name: 'A',
          role: 'r',
          store: 's',
          department: null,
          position: null,
          status: '在职',
          joinDate: null,
          createdAt: null,
          extraJson: [],
          level: 'FROM-ROW',
        }],
      }),
    },
  });
  assert.equal((await arrayExtra.dbFindEmployeeRecord('arr'))?.level, 'FROM-ROW');

  const nullExtraLevel = makeHelpers({
    pool: {
      query: async () => ({
        rows: [{
          username: 'nil',
          name: 'N',
          role: 'r',
          store: 's',
          department: null,
          position: null,
          status: '在职',
          joinDate: null,
          createdAt: null,
          extraJson: { level: null },
          level: 'ROW-FALL',
        }],
      }),
    },
  });
  assert.equal((await nullExtraLevel.dbFindEmployeeRecord('nil'))?.level, 'ROW-FALL');

  const strykerLevel = makeHelpers({
    pool: {
      query: async () => ({
        rows: [{
          username: 'sk',
          name: 'S',
          role: 'r',
          store: 's',
          department: null,
          position: null,
          status: '在职',
          joinDate: null,
          createdAt: null,
          extraJson: { level: 'Stryker was here!' },
        }],
      }),
    },
  });
  assert.equal((await strykerLevel.dbFindEmployeeRecord('sk'))?.level, 'Stryker was here!');
});

test('dbListEmployeesForReports expands store labels; filters inactive; tenant_id in params', async () => {
  let lastSql = '';
  let lastParams = null;
  let expandCalls = [];
  const { dbListEmployeesForReports } = makeHelpers({
    expandAgentStoreLabels: (s) => {
      expandCalls.push(s);
      return [s, `${s}-alias`];
    },
    pool: {
      query: async (sql, params) => {
        lastSql = sql;
        lastParams = params;
        return { rows: [{ username: 'a', name: 'A' }] };
      },
    },
  });

  const rows = await dbListEmployeesForReports({
    store: '洪潮店',
    includeInactive: false,
    tenantId: 't1',
  });
  assert.deepEqual(expandCalls, ['洪潮店']);
  assert.equal(rows.length, 1);
  assert.match(lastSql, /tenant_id\s*=\s*\$2/);
  assert.match(lastSql, /not in \('inactive', '离职'\)/);
  assert.match(lastSql, /trim\(store\)\s*=\s*ANY\(\$1::text\[\]\)/);
  assert.deepEqual(lastParams[0], ['洪潮店', '洪潮店-alias']);
  assert.equal(lastParams[1], 't1');

  // includeInactive skips status filter
  await dbListEmployeesForReports({ store: null, includeInactive: true, tenantId: 't2' });
  assert.doesNotMatch(lastSql, /not in \('inactive'/);
  assert.deepEqual(lastParams, ['t2']);

  const onErr = makeHelpers({
    pool: {
      query: async () => {
        throw new Error('boom');
      },
    },
  });
  assert.deepEqual(await onErr.dbListEmployeesForReports({}), []);
});

test('dbListEmployeesForReports: empty store labels skipped; default tenant; WHERE and-join; non-array rows', async () => {
  let lastSql = '';
  let lastParams = null;
  const { dbListEmployeesForReports } = makeHelpers({
    expandAgentStoreLabels: () => ['', '   '],
    pool: {
      query: async (sql, params) => {
        lastSql = sql;
        lastParams = params;
        return { rows: null };
      },
    },
  });

  const rows = await dbListEmployeesForReports({
    store: '洪潮店',
    includeInactive: false,
    tenantId: undefined,
  });
  assert.deepEqual(rows, []);
  assert.doesNotMatch(lastSql, /trim\(store\)\s*=\s*ANY/);
  assert.match(lastSql, /^[\s\S]*where[\s\S]* and [\s\S]*$/i);
  assert.match(lastSql, /not in \('inactive', '离职'\)/);
  assert.match(lastSql, /order by name asc, username asc/i);
  assert.deepEqual(lastParams, ['default']);

  await dbListEmployeesForReports({ store: null, includeInactive: true });
  assert.match(lastSql, /where tenant_id = \$1/i);
  assert.doesNotMatch(lastSql, /\s and /);
  assert.deepEqual(lastParams, ['default']);
});

test('stateOrDbFindUserRecord: state hit skips db; miss falls through to db', async () => {
  let queryCalls = 0;
  const { stateOrDbFindUserRecord } = makeHelpers({
    pool: {
      query: async () => {
        queryCalls += 1;
        return {
          rows: [{
            username: 'db_user',
            name: 'DB',
            role: 'admin',
            store: 'HQ',
            department: null,
            position: null,
            status: '在职',
            joinDate: null,
            createdAt: null,
            extraJson: {},
          }],
        };
      },
    },
  });

  const hit = await stateOrDbFindUserRecord(
    { employees: [{ username: 'alice', store: '洪潮店' }] },
    'alice'
  );
  assert.equal(hit?.store, '洪潮店');
  assert.equal(queryCalls, 0);

  const miss = await stateOrDbFindUserRecord({ employees: [], users: [] }, 'db_user');
  assert.equal(miss?.username, 'db_user');
  assert.equal(queryCalls, 1);
});

test('pickMyStoreFromState returns store from employee record; empty when missing', () => {
  const { pickMyStoreFromState } = makeHelpers();
  assert.equal(
    pickMyStoreFromState({ employees: [{ username: 'alice', store: ' 洪潮店 ' }] }, 'ALICE'),
    '洪潮店'
  );
  assert.equal(pickMyStoreFromState({}, 'alice'), '');
  assert.equal(pickMyStoreFromState({ employees: [{ username: 'bob' }] }, 'alice'), '');
  assert.equal(
    pickMyStoreFromState({ users: [{ username: 'legacy', store: '  U店 ' }] }, 'LEGACY'),
    'U店'
  );
  assert.equal(pickMyStoreFromState({ employees: [{ username: 'bob' }] }, 'bob'), '');
});
