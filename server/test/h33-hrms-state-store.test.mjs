import test from 'node:test';
import assert from 'node:assert/strict';
import { createHrmsStateStoreHelpers } from '../domains/shared/hrms-state-store.js';

function makePool(handlers) {
  return {
    async query(sql, params) {
      if (handlers.query) return handlers.query(sql, params);
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, params) {
          return handlers.clientQuery(sql, params);
        },
        release() {
          handlers.released = (handlers.released || 0) + 1;
        },
      };
    },
  };
}

test('getSharedState returns data object or null', async () => {
  const { getSharedState } = createHrmsStateStoreHelpers({
    pool: {
      async query(_s, p) {
        assert.equal(p[0], 't1');
        return { rows: [{ data: { a: 1 } }] };
      },
    },
    resolveTenantIdDefault: (t) => t || 'default',
    schedulePayrollDomainSync: () => {},
    scheduleLeaveDomainSync: () => {},
    dualWriteStateToDB: async () => {},
    applyHrmsUserAccountGateFromEmployee: async () => {},
    upsertEmployeeFromStateShape: async () => {},
    notifyAdminsDualWriteFailure: () => {},
  });
  assert.deepEqual(await getSharedState('t1'), { a: 1 });
});

test('saveSharedState merges, schedules, dual-writes', async () => {
  const calls = { payroll: 0, leave: 0, dual: null };
  const handlers = {
    released: 0,
    async clientQuery(sql) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) {
        return { rows: [{ data: { keep: true, x: 1 }, updated_at: 'ts1' }] };
      }
      if (/UPDATE hrms_state/.test(sql)) {
        return { rowCount: 1 };
      }
      if (/COMMIT/.test(sql)) return {};
      return {};
    },
  };
  const { saveSharedState } = createHrmsStateStoreHelpers({
    pool: makePool(handlers),
    resolveTenantIdDefault: () => 'default',
    schedulePayrollDomainSync: () => {
      calls.payroll += 1;
    },
    scheduleLeaveDomainSync: () => {
      calls.leave += 1;
    },
    dualWriteStateToDB: async (merged) => {
      calls.dual = merged;
    },
    applyHrmsUserAccountGateFromEmployee: async () => {},
    upsertEmployeeFromStateShape: async () => {},
    notifyAdminsDualWriteFailure: () => {},
  });
  await saveSharedState({ x: 2, y: 3 });
  assert.equal(calls.payroll, 1);
  assert.equal(calls.leave, 1);
  assert.equal(calls.dual.keep, true);
  assert.equal(calls.dual.x, 2);
  assert.equal(calls.dual.y, 3);
  assert.equal(handlers.released, 1);
});

test('mergeSharedStateFields array id merge + employee side effects', async () => {
  const gated = [];
  const upserted = [];
  let scheduled = 0;
  const handlers = {
    async clientQuery(sql, params) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) {
        return {
          rows: [
            {
              data: {
                employees: [{ username: 'alice', status: 'active' }],
                pointRecords: [{ id: '1', v: 'old' }],
              },
              updated_at: 't0',
            },
          ],
        };
      }
      if (/UPDATE hrms_state/.test(sql)) {
        const next = JSON.parse(params[1]);
        handlers.saved = next;
        return { rowCount: 1 };
      }
      if (/COMMIT/.test(sql)) return {};
      return {};
    },
  };
  const { mergeSharedStateFields } = createHrmsStateStoreHelpers({
    pool: makePool(handlers),
    resolveTenantIdDefault: () => 'default',
    schedulePayrollDomainSync: () => {
      scheduled += 1;
    },
    scheduleLeaveDomainSync: () => {
      scheduled += 1;
    },
    dualWriteStateToDB: async () => {},
    applyHrmsUserAccountGateFromEmployee: async (rec) => {
      gated.push(rec.username);
    },
    upsertEmployeeFromStateShape: async (_pool, key, rec) => {
      upserted.push({ key, u: rec.username });
    },
    notifyAdminsDualWriteFailure: () => {},
  });
  await mergeSharedStateFields(
    {
      employees: [{ username: 'alice', status: 'inactive' }],
      pointRecords: [{ id: '1', v: 'new' }, { id: '2', v: 'x' }],
    },
    { employees: 'username', pointRecords: 'id' }
  );
  assert.equal(handlers.saved.employees[0].status, 'inactive');
  assert.equal(handlers.saved.pointRecords.find((p) => p.id === '1').v, 'new');
  assert.ok(handlers.saved.pointRecords.some((p) => p.id === '2'));
  assert.deepEqual(gated, ['alice']);
  assert.deepEqual(upserted, [{ key: 'default', u: 'alice' }]);
  assert.equal(scheduled, 2);
});

test('mergeSharedStateFields：表已 inactive 时不被镜像 active 冲回', async () => {
  const upserted = [];
  const handlers = {
    async clientQuery(sql, params) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) {
        return {
          rows: [{
            data: { employees: [{ username: 'bob', status: 'active' }] },
            updated_at: 't0',
          }],
        };
      }
      if (/UPDATE hrms_state/.test(sql)) {
        handlers.saved = JSON.parse(params[1]);
        return { rowCount: 1 };
      }
      if (/COMMIT/.test(sql)) return {};
      return {};
    },
    async poolQuery(sql) {
      if (/SELECT status FROM employees/i.test(sql)) {
        return { rows: [{ status: 'inactive' }] };
      }
      return { rows: [] };
    },
  };
  const { mergeSharedStateFields } = createHrmsStateStoreHelpers({
    pool: {
      connect: async () => ({
        query: (sql, params) => handlers.clientQuery(sql, params),
        release: () => {},
      }),
      query: (sql, params) => handlers.poolQuery(sql, params),
    },
    resolveTenantIdDefault: () => 'default',
    schedulePayrollDomainSync: () => {},
    scheduleLeaveDomainSync: () => {},
    dualWriteStateToDB: async () => {},
    applyHrmsUserAccountGateFromEmployee: async () => {},
    upsertEmployeeFromStateShape: async (_pool, key, rec) => {
      upserted.push({ key, status: rec.status });
    },
    notifyAdminsDualWriteFailure: () => {},
  });
  await mergeSharedStateFields(
    { employees: [{ username: 'bob', status: 'active' }] },
    { employees: 'username' }
  );
  assert.equal(upserted[0]?.status, 'inactive');
});

test('removeEmployeesFromSharedState filters employees and users', async () => {
  const handlers = {
    async clientQuery(sql, params) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) {
        return {
          rows: [
            {
              data: {
                employees: [{ username: 'Alice' }, { username: 'bob' }],
                users: [{ username: 'alice' }, { username: 'carol' }],
              },
              updated_at: 't0',
            },
          ],
        };
      }
      if (/UPDATE hrms_state/.test(sql)) {
        handlers.saved = JSON.parse(params[1]);
        return { rowCount: 1 };
      }
      if (/COMMIT/.test(sql)) return {};
      return {};
    },
  };
  const { removeEmployeesFromSharedState } = createHrmsStateStoreHelpers({
    pool: makePool(handlers),
    resolveTenantIdDefault: () => 'default',
    schedulePayrollDomainSync: () => {},
    scheduleLeaveDomainSync: () => {},
    dualWriteStateToDB: async () => {},
    applyHrmsUserAccountGateFromEmployee: async () => {},
    upsertEmployeeFromStateShape: async () => {},
    notifyAdminsDualWriteFailure: () => {},
  });
  await removeEmployeesFromSharedState(['alice']);
  assert.deepEqual(
    handlers.saved.employees.map((e) => e.username),
    ['bob']
  );
  assert.deepEqual(
    handlers.saved.users.map((u) => u.username),
    ['carol']
  );
});
