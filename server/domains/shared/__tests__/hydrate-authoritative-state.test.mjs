import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateAuthoritativeState } from '../hydrate-authoritative-state.js';

test('hydrateAuthoritativeState：链式调用；空/非对象原样返回；表空保留 blob', async () => {
  assert.equal(await hydrateAuthoritativeState({}, null, 'default'), null);
  assert.equal(await hydrateAuthoritativeState({}, undefined, 'default'), undefined);

  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(String(sql));
      return { rows: [] };
    },
  };
  const input = {
    pointRecords: [{ id: 'p1' }],
    employees: [{ username: 'e1' }],
    notifications: [{ id: 'n1' }],
    examResults: [{ id: 'x1' }],
    roleModules: { admin: ['a'] },
    keep: true,
  };
  const out = await hydrateAuthoritativeState(pool, input, 'default');
  assert.equal(out.keep, true);
  // pointRecords：hydrateStateFromAuthoritativeTables 在表空时仍写入 []（既有行为）
  assert.deepEqual(out.pointRecords, []);
  // employees / notifications / examResults：表空保留 state
  assert.equal(out.employees[0].username, 'e1');
  assert.equal(out.notifications[0].id, 'n1');
  assert.equal(out.examResults[0].id, 'x1');
  assert.ok(queries.length >= 3);
});
