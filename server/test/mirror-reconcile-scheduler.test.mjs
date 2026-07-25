/**
 * domains/shared/mirror-reconcile-scheduler.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorReconcileScheduler } from '../domains/shared/mirror-reconcile-scheduler.js';

async function runStarted(deps) {
  const timers = [];
  const realTimeout = global.setTimeout;
  const realInterval = global.setInterval;
  global.setTimeout = (fn, ms) => {
    timers.push({ fn, ms });
    return 1;
  };
  global.setInterval = (fn, ms) => {
    timers.push({ fn, ms, interval: true });
    return 2;
  };
  try {
    const { startMirrorReconcileScheduler } = createMirrorReconcileScheduler(deps);
    startMirrorReconcileScheduler();
    assert.equal(timers[0].ms, 60_000);
    assert.ok(timers.some((t) => t.interval && t.ms === 24 * 60 * 60 * 1000));
    // start 里是 () => void runMirrorReconcile()，需排空微任务
    timers[0].fn();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  } finally {
    global.setTimeout = realTimeout;
    global.setInterval = realInterval;
  }
}

test('runMirrorReconcile：漂移告警 + ok 日志路径', async () => {
  const notified = [];
  await runStarted({
    pool: {},
    getActiveTenantIds: async () => ['t1'],
    notifyAdminsDualWriteFailure: (scope) => {
      notified.push(scope);
    },
    reconcileEmployeesMirrorAllTenants: async () => [
      {
        ok: false,
        tenantId: 't1',
        tableCount: 2,
        mirrorCount: 3,
        onlyTable: ['a'],
        onlyMirror: ['b'],
        fieldDrift: [{ username: 'u1' }],
      },
      { ok: true, tenantId: 't2', tableCount: 1 },
    ],
    reconcileFlowConfigMirrorAllTenants: async () => [
      { ok: false, tenantId: 't1', drifts: [{ field: 'x', reason: 'diff' }] },
      { ok: true, tenantId: 't2' },
    ],
    checkStateOnlyDomainsIntegrityAllTenants: async () => [
      {
        ok: false,
        tenantId: 't1',
        domains: [{ domain: 'stores', ok: false, issues: [{ field: 'id', reason: 'missing' }] }],
      },
      { ok: true, tenantId: 't2', domains: [] },
    ],
  });
  const joined = notified.join('|');
  assert.match(joined, /employees/);
  assert.match(joined, /flow-config|flow_config|flow/);
  assert.match(joined, /state-only/);
  assert.ok(notified.length >= 3, `expected ≥3 notifies, got ${JSON.stringify(notified)}`);
});
test('runMirrorReconcile：各段 throw 吞掉；无 state-only checker 跳过', async () => {
  await runStarted({
    pool: {},
    getActiveTenantIds: async () => [],
    notifyAdminsDualWriteFailure: () => {},
    reconcileEmployeesMirrorAllTenants: async () => {
      throw new Error('emp');
    },
    reconcileFlowConfigMirrorAllTenants: async () => {
      throw new Error('flow');
    },
    // omit checkStateOnlyDomainsIntegrityAllTenants
  });

  await runStarted({
    pool: {},
    getActiveTenantIds: async () => [],
    notifyAdminsDualWriteFailure: () => {},
    reconcileEmployeesMirrorAllTenants: async () => [],
    reconcileFlowConfigMirrorAllTenants: async () => [],
    checkStateOnlyDomainsIntegrityAllTenants: async () => {
      throw new Error('state');
    },
  });
});
