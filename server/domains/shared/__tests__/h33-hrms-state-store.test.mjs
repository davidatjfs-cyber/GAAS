import test from 'node:test';
import assert from 'node:assert/strict';
import { createHrmsStateStoreHelpers } from '../hrms-state-store.js';

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
    hydrateAuthoritativeState: async (_pool, state) => state,
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

function deps(extra = {}) {
  return {
    resolveTenantIdDefault: () => 'default',
    schedulePayrollDomainSync: () => {},
    scheduleLeaveDomainSync: () => {},
    dualWriteStateToDB: async () => {},
    applyHrmsUserAccountGateFromEmployee: async () => {},
    upsertEmployeeFromStateShape: async () => {},
    notifyAdminsDualWriteFailure: () => {},
    // 单测默认跳过权威表 hydrate，避免 mock pool 被 hydrate SQL 误伤
    hydrateAuthoritativeState: async (_pool, state) => state,
    ...extra,
  };
}

test('getSharedState：无行/非对象 → null；save/merge/remove 空入参 no-op', async () => {
  // 这个文件里几乎所有测试的 resolveTenantIdDefault 都写死返回 'default'，getSharedState
  // 加了2秒TTL内存缓存(hrms-state-store.js STATE_CACHE_TTL_MS)后，同一个key在2秒内被多个
  // 测试共用——前一个测试('removeEmployeesFromSharedState filters...')会把 bob/carol 那份
  // 数据写进 'default' 这个缓存key，这个测试紧跟着跑，读到的是缓存里的脏数据而不是这里
  // mock的pool.query，导致断言的null变成了真实数据。用一个独占的tenant key避免撞缓存，
  // 不改动生产的缓存实现本身。
  const { getSharedState, saveSharedState, mergeSharedStateFields, removeEmployeesFromSharedState } =
    createHrmsStateStoreHelpers({
      pool: {
        query: async () => ({ rows: [{ data: 'x' }] }),
        connect: async () => {
          throw new Error('should_not_connect');
        },
      },
      ...deps(),
      resolveTenantIdDefault: () => '__h33_null_check_isolated__',
    });
  assert.equal(await getSharedState(), null);
  await saveSharedState({});
  await saveSharedState(null);
  await mergeSharedStateFields({});
  await removeEmployeesFromSharedState([]);
  await removeEmployeesFromSharedState(['', null]);
});

test('mergeSharedStateFields：对象合并 / 无 id 数组前插 / 标量 / gate 与 upsert 失败', async () => {
  const notified = [];
  const handlers = {
    async clientQuery(sql, params) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) {
        return {
          rows: [{
            data: {
              settings: { a: 1 },
              tags: ['old'],
              employees: [{ username: 'x', status: 'active' }],
              flag: false,
            },
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
  };
  const { mergeSharedStateFields } = createHrmsStateStoreHelpers({
    pool: makePool(handlers),
    ...deps({
      applyHrmsUserAccountGateFromEmployee: async () => {
        throw new Error('gate');
      },
      upsertEmployeeFromStateShape: async () => {
        throw new Error('upsert');
      },
      notifyAdminsDualWriteFailure: (scope) => {
        notified.push(scope);
      },
    }),
  });
  await mergeSharedStateFields(
    {
      settings: { b: 2 },
      tags: ['new'],
      flag: true,
      employees: [{ username: 'x', status: 'active' }, { username: '' }],
    },
    { employees: 'username' }
  );
  assert.deepEqual(handlers.saved.settings, { a: 1, b: 2 });
  assert.deepEqual(handlers.saved.tags, ['new', 'old']);
  assert.equal(handlers.saved.flag, true);
  assert.ok(notified.some((s) => /employees/.test(s)));
});

test('saveSharedState / merge / remove：乐观锁冲突耗尽抛错', async () => {
  const handlers = {
    async clientQuery(sql) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) {
        return { rows: [{ data: {}, updated_at: 't0' }] };
      }
      if (/UPDATE hrms_state/.test(sql)) return { rowCount: 0 };
      if (/ROLLBACK/.test(sql)) return {};
      return {};
    },
  };
  const h = createHrmsStateStoreHelpers({ pool: makePool(handlers), ...deps() });
  await assert.rejects(() => h.saveSharedState({ a: 1 }), /max retries exceeded/);
  await assert.rejects(() => h.mergeSharedStateFields({ a: 1 }), /max retries exceeded/);
  await assert.rejects(() => h.removeEmployeesFromSharedState(['a']), /max retries exceeded/);
});

test('saveSharedState：client 抛错走 ROLLBACK 再抛出', async () => {
  const handlers = {
    async clientQuery(sql) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) throw new Error('lock_fail');
      if (/ROLLBACK/.test(sql)) return {};
      return {};
    },
  };
  const { saveSharedState } = createHrmsStateStoreHelpers({ pool: makePool(handlers), ...deps() });
  await assert.rejects(() => saveSharedState({ a: 1 }), /lock_fail/);
});

test('merge / remove：client 抛错走 ROLLBACK 再抛出', async () => {
  const handlers = {
    async clientQuery(sql) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) throw new Error('m_fail');
      if (/ROLLBACK/.test(sql)) return {};
      return {};
    },
  };
  const h = createHrmsStateStoreHelpers({ pool: makePool(handlers), ...deps() });
  await assert.rejects(() => h.mergeSharedStateFields({ a: 1 }), /m_fail/);
  await assert.rejects(() => h.removeEmployeesFromSharedState(['z']), /m_fail/);
});
test('getSharedState：hydrate 后写入缓存；invalidate 后重新 hydrate', async () => {
  let hydrateCalls = 0;
  let reads = 0;
  const { getSharedState, invalidateSharedStateCache } = createHrmsStateStoreHelpers({
    pool: {
      async query() {
        reads += 1;
        return { rows: [{ data: { blob: true, employees: [{ username: 'stale' }] } }] };
      },
    },
    ...deps({
      hydrateAuthoritativeState: async (_pool, state) => {
        hydrateCalls += 1;
        return { ...state, employees: [{ username: 'fresh' }] };
      },
    }),
  });
  const a = await getSharedState('default');
  assert.equal(a.employees[0].username, 'fresh');
  assert.equal(hydrateCalls, 1);
  assert.equal(reads, 1);
  const b = await getSharedState('default');
  assert.equal(b.employees[0].username, 'fresh');
  assert.equal(hydrateCalls, 1);
  assert.equal(reads, 1);
  invalidateSharedStateCache('default');
  const c = await getSharedState('default');
  assert.equal(c.employees[0].username, 'fresh');
  assert.equal(hydrateCalls, 2);
  assert.equal(reads, 2);
});

test('saveSharedState 成功后 invalidate，下次 get 会重新读库+hydrate', async () => {
  let hydrateCalls = 0;
  const handlers = {
    released: 0,
    async clientQuery(sql) {
      if (/BEGIN/.test(sql)) return {};
      if (/SELECT data, updated_at/.test(sql)) {
        return { rows: [{ data: { keep: true }, updated_at: 'ts1' }] };
      }
      if (/UPDATE hrms_state/.test(sql)) return { rowCount: 1 };
      if (/COMMIT/.test(sql)) return {};
      return {};
    },
  };
  let selectCount = 0;
  const pool = {
    async query() {
      selectCount += 1;
      return { rows: [{ data: { keep: true, fromDb: selectCount } }] };
    },
    async connect() {
      return {
        async query(sql, params) {
          return handlers.clientQuery(sql, params);
        },
        release() {
          handlers.released += 1;
        },
      };
    },
  };
  const tid = 'tenant-save-invalidate';
  const { getSharedState, saveSharedState, invalidateSharedStateCache } = createHrmsStateStoreHelpers({
    pool,
    ...deps({
      resolveTenantIdDefault: (t) => t || tid,
      hydrateAuthoritativeState: async (_p, state) => {
        hydrateCalls += 1;
        return { ...state, hydrated: hydrateCalls };
      },
    }),
  });
  invalidateSharedStateCache(tid);
  const first = await getSharedState(tid);
  assert.equal(first.hydrated, 1);
  await saveSharedState({ x: 1 }, tid);
  const second = await getSharedState(tid);
  assert.equal(second.hydrated, 2);
  assert.equal(selectCount, 2);
});
