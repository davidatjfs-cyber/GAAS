import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserLookupHelpers } from '../domains/employees/user-lookup.js';

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
});
