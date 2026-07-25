/**
 * domains/ops-tasks/create-task.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpsTaskCreateHelpers } from '../domains/ops-tasks/create-task.js';

test('createOpsTaskIfAbsent：缺 dedupeKey no-op；有则 insert', async () => {
  const queries = [];
  const { createOpsTaskIfAbsent } = createOpsTaskCreateHelpers({
    pool: {
      query: async (...args) => {
        queries.push(args);
        return {};
      },
    },
    safeDateOnly: (d) => d,
    getSharedState: async () => ({}),
    resolveTenantIdDefault: () => 'default',
    getOpsManagedStores: () => [],
    resolveOpsStoreBrand: () => null,
    buildOpsTaskTemplates: () => [],
    getOpsStoreAssignee: () => null,
  });
  await createOpsTaskIfAbsent({});
  assert.equal(queries.length, 0);
  await createOpsTaskIfAbsent({
    dedupeKey: 'k1',
    bizDate: '2026-07-01',
    store: 'S1',
    brand: 'B1',
    taskType: 'lunch',
    scheduleKey: 'lunch',
    title: 't',
    checklist: ['a'],
    requiredPhotos: 0,
    assigneeUsername: 'u1',
    assigneeRole: 'store_product_manager',
    dueAt: '2026-07-01T11:00:00+08:00',
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0][0], /insert into ops_tasks/i);
  assert.equal(queries[0][1][11], 'store_production_manager'); // role normalized
  assert.equal(queries[0][1][9], 1); // requiredPhotos max(1,0)
  assert.equal(queries[0][1][14], 'default');
});

test('ensureOpsTasksForDate：坏日期 / 无品牌 / 无负责人 / 成功创建', async () => {
  const created = [];
  const helpers = createOpsTaskCreateHelpers({
    pool: {
      query: async (_sql, params) => {
        created.push(params[5]); // dedupe_key
        return {};
      },
    },
    safeDateOnly: (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : ''),
    getSharedState: async () => ({ ok: 1 }),
    resolveTenantIdDefault: () => 't1',
    getOpsManagedStores: () => ['有品牌店', '无品牌店', '无负责人店'],
    resolveOpsStoreBrand: (_s, store) => (store === '无品牌店' ? null : '洪潮传统潮汕菜'),
    buildOpsTaskTemplates: (store) => [
      {
        taskType: 'lunch_check',
        scheduleKey: 'lunch',
        title: `${store}-午餐`,
        checklist: ['桌面'],
        requiredPhotos: 2,
        assigneeRole: 'store_manager',
        dueAt: '2026-07-01T11:00:00+08:00',
      },
    ],
    getOpsStoreAssignee: (_s, store) => (store === '无负责人店' ? null : 'mgr1'),
  });

  await helpers.ensureOpsTasksForDate('bad');
  assert.equal(created.length, 0);

  await helpers.ensureOpsTasksForDate('2026-07-01');
  assert.equal(created.length, 1);
  assert.equal(created[0], '2026-07-01||有品牌店||lunch||mgr1');
});
