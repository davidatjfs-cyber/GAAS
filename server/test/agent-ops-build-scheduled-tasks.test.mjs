import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildScheduledTasksFromConfig } from '../domains/agent-ops/build-scheduled-tasks-from-config.js';

function makeBuilder(overrides = {}) {
  return createBuildScheduledTasksFromConfig({
    getOpsAgentConfig: () => ({
      scheduledTasks: {
        dailyInspections: [
          {
            enabled: true,
            store: '洪潮久光店',
            brand: '洪潮',
            type: 'opening',
            time: '09:00',
            timeWindow: 30,
          },
          {
            enabled: false,
            store: 'x',
            brand: 'y',
            type: 'closing',
            time: '22:00',
          },
          {
            // incomplete → skip
            type: 'opening',
            time: '',
          },
        ],
        randomInspections: [
          {
            enabled: true,
            type: '冷柜',
            description: '查温度',
            store: '洪潮久光店',
            brand: '洪潮',
            intervalMinHours: 2,
            intervalMaxHours: 4,
            timeWindow: 15,
            assigneeRoles: ['store_manager'],
          },
          { enabled: true, type: '' },
          { enabled: false, type: '禁用' },
        ],
      },
    }),
    isBlockedOpsChecklistPattern: () => false,
    env: { HRMS_ENABLE_LEGACY_SCHEDULED_CHECKLIST: '1' },
    ...overrides,
  });
}

test('legacy flag off → empty', () => {
  const build = makeBuilder({ env: {} });
  assert.deepEqual(build(), {});
});

test('builds daily + random keys', () => {
  const runtime = makeBuilder()();
  assert.ok(runtime['洪潮久光店_开市']);
  assert.equal(runtime['洪潮久光店_开市'].action, 'send_checklist');
  assert.equal(runtime['洪潮久光店_开市'].checkType, 'opening');
  assert.equal(runtime['洪潮久光店_开市'].timeWindow, 30);
  const randKey = Object.keys(runtime).find((k) => k.startsWith('随机抽检_'));
  assert.ok(randKey);
  assert.equal(runtime[randKey].action, 'safety_check');
  assert.deepEqual(runtime[randKey].interval, [2, 4]);
  assert.deepEqual(runtime[randKey].assigneeRoles, ['store_manager']);
});

test('blocked patterns skipped', () => {
  const runtime = makeBuilder({
    isBlockedOpsChecklistPattern: () => true,
  })();
  assert.deepEqual(runtime, {});
});

test('user cleared empty arrays → {}', () => {
  const build = makeBuilder({
    getOpsAgentConfig: () => ({
      scheduledTasks: { dailyInspections: [], randomInspections: [] },
    }),
  });
  assert.deepEqual(build(), {});
});

test('explicit config with no valid keys → {}', () => {
  const build = makeBuilder({
    getOpsAgentConfig: () => ({
      scheduledTasks: {
        dailyInspections: [{ type: 'opening', time: '09:00' }], // missing store+brand
        randomInspections: [{ type: '' }],
      },
    }),
  });
  assert.deepEqual(build(), {});
});

test('no config → default tasks', () => {
  const build = makeBuilder({
    getOpsAgentConfig: () => ({}),
    defaultScheduledTasks: { demo: { action: 'send_checklist' } },
  });
  assert.deepEqual(build(), { demo: { action: 'send_checklist' } });
});

test('closing label + brand-only identity + default assigneeRoles', () => {
  const runtime = makeBuilder({
    getOpsAgentConfig: () => ({
      scheduledTasks: {
        dailyInspections: [
          { brand: '洪潮', type: 'closing', time: '22:00', frequency: 'weekly' },
        ],
        randomInspections: [{ type: '食安', interval: [3, 6] }],
      },
    }),
  })();
  assert.ok(runtime['洪潮_收档']);
  assert.equal(runtime['洪潮_收档'].frequency, 'weekly');
  const rand = Object.values(runtime).find((t) => t.random);
  assert.deepEqual(rand.interval, [3, 6]);
  assert.deepEqual(rand.assigneeRoles, ['store_manager', 'store_production_manager']);
});

test('custom type label in daily key', () => {
  const runtime = makeBuilder({
    getOpsAgentConfig: () => ({
      scheduledTasks: {
        dailyInspections: [{ store: 'A店', type: 'hygiene', time: '10:00' }],
        randomInspections: [],
      },
    }),
  })();
  assert.ok(runtime['A店_hygiene']);
});
