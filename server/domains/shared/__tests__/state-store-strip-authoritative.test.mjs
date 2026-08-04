/**
 * hrms_state 写入时剥离「真表权威」字段。
 *
 * 2026-08-04：手工把 dailyReports 从 blob 删掉（5247→3835 kB）后几分钟就涨了回来——
 * 业务代码普遍是「getSharedState() 拿 hydrate 后的完整 state → 改一点 → saveSharedState()」，
 * hydrate 填进来的表数据被原样写回。只删数据不改写入路径堵不住，这里锁住写入侧的剥离。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHrmsStateStoreHelpers } from '../hrms-state-store.js';

/** 极简 pg pool 替身：记录最后一次 UPDATE 写进去的 JSON */
function makeFakePool(initialData = {}) {
  const captured = { lastWritten: null };
  const client = {
    async query(sql, params) {
      if (/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/i.test(sql)) return { rowCount: 0, rows: [] };
      if (/SELECT data, updated_at FROM hrms_state/i.test(sql)) {
        return { rows: [{ data: initialData, updated_at: 'T0' }] };
      }
      if (/UPDATE hrms_state SET data/i.test(sql)) {
        captured.lastWritten = JSON.parse(params[1]);
        return { rowCount: 1 };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  return {
    captured,
    pool: {
      async connect() { return client; },
      async query() { return { rows: [], rowCount: 0 }; },
    },
  };
}

function makeHelpers(initialData) {
  const { pool, captured } = makeFakePool(initialData);
  const helpers = createHrmsStateStoreHelpers({
    pool,
    resolveTenantIdDefault: () => 'default',
    schedulePayrollDomainSync: () => {},
    scheduleLeaveDomainSync: () => {},
    dualWriteStateToDB: async () => {},
    applyHrmsUserAccountGateFromEmployee: async () => {},
    upsertEmployeeFromStateShape: async () => {},
    notifyAdminsDualWriteFailure: () => {},
    hydrateAuthoritativeState: async (_p, s) => s,
  });
  return { helpers, captured };
}

test('saveSharedState 不把 hydrate 来的 dailyReports 写回 blob', async () => {
  const { helpers, captured } = makeHelpers({ settings: { a: 1 } });
  // 模拟「拿到 hydrate 后的完整 state（含表来的 dailyReports），改一点再存回」
  await helpers.saveSharedState({
    settings: { a: 2 },
    dailyReports: [{ id: 'dr1' }, { id: 'dr2' }],
  });
  assert.ok(captured.lastWritten, '应发生一次写入');
  assert.equal(captured.lastWritten.dailyReports, undefined, 'dailyReports 不应被持久化');
  assert.deepEqual(captured.lastWritten.settings, { a: 2 }, '其它字段照常写入');
});

test('saveSharedState 顺手清掉 blob 里已有的 dailyReports 残留', async () => {
  const { helpers, captured } = makeHelpers({
    settings: { a: 1 },
    dailyReports: [{ id: 'old' }],
  });
  await helpers.saveSharedState({ settings: { a: 2 } });
  assert.equal(captured.lastWritten.dailyReports, undefined, '历史残留也应被剥掉');
});

test('mergeSharedStateFields 同样不写回 dailyReports', async () => {
  const { helpers, captured } = makeHelpers({ dailyReports: [{ id: 'old' }], employees: [] });
  await helpers.mergeSharedStateFields({ pointRules: { x: 1 } });
  assert.equal(captured.lastWritten.dailyReports, undefined);
  assert.deepEqual(captured.lastWritten.pointRules, { x: 1 });
});

test('不误伤其它字段（尤其表为空的 inventoryForecastHistory 必须保留）', async () => {
  const { helpers, captured } = makeHelpers({});
  await helpers.saveSharedState({
    inventoryForecastHistory: [{ id: 'h1' }],
    notifications: [{ id: 'n1' }],
    pointRecords: [{ id: 'p1' }],
  });
  assert.equal(captured.lastWritten.inventoryForecastHistory.length, 1, '表为空，剥离会丢数据，必须保留');
  assert.equal(captured.lastWritten.notifications.length, 1);
  assert.equal(captured.lastWritten.pointRecords.length, 1);
});
