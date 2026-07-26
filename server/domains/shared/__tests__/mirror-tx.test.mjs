/**
 * 通用 hrms_state 镜像事务原语（单元级 mock client）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeStateFieldsOnClient,
  patchHrmsStateFieldsOnClient,
  withMirrorWriteTx,
} from '../mirror-tx.js';
import { reconcileEmployeesMirror } from '../../employees/mirror-tx.js';

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
      if (/SELECT 1 FROM/i.test(s)) {
        return { rows: data == null ? [] : [{ '?column?': 1 }] };
      }
      if (/hrms_state/i.test(s) && /SELECT/i.test(s)) {
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

test('withMirrorWriteTx rolls back on throw', async () => {
  let released = false;
  const client = mockClient({ roleModules: {} });
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
      withMirrorWriteTx(pool, async () => {
        throw new Error('boom');
      }),
    /boom/
  );
  assert.equal(released, true);
  assert.ok(client.queries.some((q) => /^\s*ROLLBACK/i.test(q.sql)));
});

test('patchHrmsStateFieldsOnClient merges top-level keys', async () => {
  const client = mockClient({ paymentSettings: { a: 1 }, stores: [{ id: 's1' }] });
  await patchHrmsStateFieldsOnClient(client, 'default', { paymentSettings: { b: 2 } });
  assert.deepEqual(client.data.paymentSettings, { b: 2 });
  assert.deepEqual(client.data.stores, [{ id: 's1' }]);
});

test('mergeStateFieldsOnClient merges array by id field', async () => {
  const client = mockClient({ announcements: [{ id: '1', title: 'old' }] });
  await mergeStateFieldsOnClient(
    client,
    'default',
    { announcements: [{ id: '1', title: 'new' }] },
    { announcements: 'id' }
  );
  assert.equal(client.data.announcements.length, 1);
  assert.equal(client.data.announcements[0].title, 'new');
});

test('reconcileEmployeesMirror catches field drift (same username, different status)', async () => {
  const pool = {
    async query(sql) {
      if (/FROM employees\b/i.test(sql)) {
        return {
          rows: [
            {
              id: '1',
              username: 'alice',
              name: 'Alice',
              role: 'staff',
              store: 's1',
              department: '',
              position: '',
              status: 'active',
            },
          ],
        };
      }
      return {
        rows: [
          {
            emps: [{ username: 'alice', name: 'Alice', role: 'staff', store: 's1', status: 'inactive' }],
          },
        ],
      };
    },
  };
  const report = await reconcileEmployeesMirror(pool, 'default');
  assert.equal(report.ok, false);
  assert.equal(report.onlyTable.length, 0);
  assert.equal(report.onlyMirror.length, 0);
  assert.equal(report.fieldDrift.length, 1);
  assert.equal(report.fieldDrift[0].username, 'alice');
  assert.equal(report.fieldDrift[0].reason, 'content_hash_mismatch');
});
