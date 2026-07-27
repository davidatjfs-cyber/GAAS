import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runHrmsCliSyncTableVisitIfRequested,
  runHttpListenBootstrap,
  startPostRouteModuleLoadRuntime,
} from '../startup-listen-or-cli.js';

test('runHrmsCliSyncTableVisitIfRequested no-ops when env unset', async () => {
  const r = await runHrmsCliSyncTableVisitIfRequested({
    env: {},
    log: { info: () => {}, error: () => {} },
  });
  assert.equal(r, false);
});

test('runHrmsCliSyncTableVisitIfRequested exits 0 on success and 1 on failure', async () => {
  const exits = [];
  const ok = await runHrmsCliSyncTableVisitIfRequested({
    env: { HRMS_CLI_SYNC_TABLE_VISIT: '1' },
    log: { info: () => {}, error: () => {} },
    ensureFeishuGenericRecordsTable: async () => {},
    ensureFeishuGenericRecordsNotifyTrigger: async () => {},
    ensureTableVisitRecordsTable: async () => {},
    runManualFeishuBitableSync: async () => ({ n: 1 }),
    syncDeps: {},
    syncOptions: {},
    exitFn: (c) => exits.push(c),
  });
  assert.equal(ok, true);
  assert.deepEqual(exits, [0]);

  const exits2 = [];
  await runHrmsCliSyncTableVisitIfRequested({
    env: { HRMS_CLI_SYNC_TABLE_VISIT: '1' },
    log: { info: () => {}, error: () => {} },
    ensureFeishuGenericRecordsTable: async () => { throw new Error('x'); },
    ensureFeishuGenericRecordsNotifyTrigger: async () => {},
    ensureTableVisitRecordsTable: async () => {},
    runManualFeishuBitableSync: async () => ({}),
    syncDeps: {},
    syncOptions: {},
    exitFn: (c) => exits2.push(c),
  });
  assert.deepEqual(exits2, [1]);
});

test('runHttpListenBootstrap orders startup steps and continues after init error', async () => {
  const order = [];
  await runHttpListenBootstrap({
    log: {
      info: (p) => order.push(['info', p.msg]),
      error: (p) => order.push(['err', p.msg]),
    },
    host: '0.0.0.0',
    port: 3000,
    runStartupAgentSchemaBootstrap: async () => { order.push('schema'); throw new Error('boom'); },
    agentSchemaDeps: {},
    runStartupTenantReconcile: async () => { order.push('reconcile'); },
    startListenMonitors: async () => { order.push('monitors'); },
    startRecurringRewardScheduler: () => { order.push('reward'); },
    runStartupModuleSchedulers: async () => { order.push('modules'); },
    moduleSchedulerDeps: {},
    runStartupRoleCleanup: async () => { order.push('roles'); },
    roleCleanupDeps: {},
  });
  assert.deepEqual(order.filter((x) => typeof x === 'string'), ['schema', 'roles']);
  assert.ok(order.some((x) => Array.isArray(x) && x[0] === 'err'));
});

test('runHttpListenBootstrap happy path runs full sequence', async () => {
  const order = [];
  await runHttpListenBootstrap({
    log: { info: () => {}, error: () => {} },
    host: '127.0.0.1',
    port: 1,
    runStartupAgentSchemaBootstrap: async () => { order.push('schema'); },
    agentSchemaDeps: {},
    runStartupTenantReconcile: async () => { order.push('reconcile'); },
    startListenMonitors: async () => { order.push('monitors'); },
    startRecurringRewardScheduler: () => { order.push('reward'); },
    runStartupModuleSchedulers: async () => { order.push('modules'); },
    moduleSchedulerDeps: {},
    runStartupRoleCleanup: async () => { order.push('roles'); },
    roleCleanupDeps: {},
  });
  assert.deepEqual(order, ['schema', 'reconcile', 'monitors', 'reward', 'modules', 'roles']);
});

test('startPostRouteModuleLoadRuntime starts schema/offboarding/birthday/monitors', async () => {
  const calls = [];
  startPostRouteModuleLoadRuntime({
    runModuleLoadSchemaEnsure: async () => {
      calls.push('schema');
      throw new Error('schema boom');
    },
    moduleLoadSchemaDeps: {},
    log: { error: (p) => { calls.push(['err', p.msg]); } },
    createOffboardingPromotionScheduler: () => ({
      startOffboardingPromotionScheduler: () => { calls.push('off'); },
    }),
    offboardingDeps: {},
    createBirthdayScheduler: () => ({
      startBirthdayGreetingScheduler: () => { calls.push('bday'); },
    }),
    birthdayDeps: {},
    createAiQualitySchedulerHandlers: () => ({ generateCandidate: 1 }),
    aiQualityHandlerDeps: {},
    startBackgroundRuntimeMonitors: (d) => {
      calls.push(['mon', d.aiQualityHandlers.generateCandidate]);
    },
    backgroundMonitorDeps: { log: {} },
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(calls.includes('off') && calls.includes('bday'));
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'mon' && c[1] === 1));
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'err'));
});
