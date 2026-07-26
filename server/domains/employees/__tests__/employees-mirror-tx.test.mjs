/**
 * 员工窄接口：表写 + 镜像同事务（单元级，不连真库）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeEmployeesMirrorOnClient,
  removeEmployeesMirrorOnClient,
  reconcileEmployeesMirror,
  withEmployeesWriteTx,
} from '../mirror-tx.js';

function mockClient(initialData) {
  let data = initialData;
  let inTx = false;
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      const s = String(sql);
      if (/^\s*BEGIN/i.test(s)) {
        inTx = true;
        return { rows: [] };
      }
      if (/^\s*COMMIT/i.test(s)) {
        inTx = false;
        return { rows: [] };
      }
      if (/^\s*ROLLBACK/i.test(s)) {
        inTx = false;
        return { rows: [] };
      }
      if (/FROM hrms_state|FROM \$\{/.test(s) || /hrms_state/i.test(s) && /SELECT/i.test(s)) {
        return { rows: data == null ? [] : [{ data }] };
      }
      if (/UPDATE/i.test(s) || /INSERT INTO/i.test(s)) {
        if (params?.[1]) {
          data = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        }
        return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    },
    get data() {
      return data;
    },
    get inTx() {
      return inTx;
    },
  };
}

test('mergeEmployeesMirrorOnClient merges by username', async () => {
  const client = mockClient({ employees: [{ username: 'a', name: 'A' }] });
  await mergeEmployeesMirrorOnClient(client, [{ username: 'b', name: 'B' }], 'default');
  assert.equal(client.data.employees.length, 2);
  assert.ok(client.data.employees.some((e) => e.username === 'b'));
});

test('removeEmployeesMirrorOnClient drops username', async () => {
  const client = mockClient({
    employees: [
      { username: 'a', name: 'A' },
      { username: 'b', name: 'B' },
    ],
  });
  await removeEmployeesMirrorOnClient(client, ['a'], 'default');
  assert.deepEqual(
    client.data.employees.map((e) => e.username),
    ['b']
  );
});

test('withEmployeesWriteTx rolls back on throw', async () => {
  let released = false;
  const client = mockClient({ employees: [] });
  const pool = {
    connect: async () => ({
      ...client,
      release() {
        released = true;
      },
      async query(sql, params) {
        return client.query(sql, params);
      },
    }),
  };
  await assert.rejects(
    () =>
      withEmployeesWriteTx(pool, async () => {
        throw new Error('boom');
      }),
    /boom/
  );
  assert.equal(released, true);
  assert.ok(client.queries.some((q) => /^\s*ROLLBACK/i.test(q.sql)));
});

test('reconcileEmployeesMirror reports ok when sets match', async () => {
  const emp = (username, name) => ({
    id: username,
    username,
    name,
    role: 'staff',
    store: 's1',
    department: '',
    position: '',
    status: 'active',
  });
  const pool = {
    async query(sql) {
      if (/FROM employees\b/i.test(sql)) {
        return { rows: [emp('alice', 'Alice'), emp('bob', 'Bob')] };
      }
      return {
        rows: [
          {
            emps: [
              { username: 'Alice', name: 'Alice', role: 'staff', store: 's1', status: 'active' },
              { username: 'bob', name: 'Bob', role: 'staff', store: 's1', status: 'active' },
            ],
          },
        ],
      };
    },
  };
  const report = await reconcileEmployeesMirror(pool, 'default');
  assert.equal(report.ok, true);
  assert.equal(report.tableCount, 2);
  assert.equal(report.mirrorCount, 2);
  assert.deepEqual(report.fieldDrift, []);
});
