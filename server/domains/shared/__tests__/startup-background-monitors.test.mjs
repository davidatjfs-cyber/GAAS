import test from 'node:test';
import assert from 'node:assert/strict';
import { startBackgroundRuntimeMonitors } from '../startup-background-monitors.js';

test('startBackgroundRuntimeMonitors wires guards/schedulers/AI quality', async () => {
  const calls = [];
  let driftNotify;
  let procNotify;
  startBackgroundRuntimeMonitors({
    registerProcessGuards: (d) => { calls.push(['guards', !!d.sendLarkMessage]); },
    sendLarkMessage: async (to, msg) => { calls.push(['lark', to, String(msg).slice(0, 20)]); },
    FEISHU_ALERT_ADMIN_HEALTH: 'h',
    FEISHU_ALERT_ADMIN_GROWTH: 'g',
    createNotificationsCleanupScheduler: () => ({
      startNotificationsCleanupScheduler: () => { calls.push('notif'); },
    }),
    createFreshnessMonitorScheduler: () => ({
      startFreshnessMonitorScheduler: () => { calls.push('fresh'); },
    }),
    pool: { tag: 'p' },
    runForActiveTenants: async () => {},
    runFreshnessCheck: async () => {},
    FRESHNESS_SOURCES: [],
    startSchemaMigrationDriftMonitor: (pool, opts) => {
      calls.push(['drift', pool.tag]);
      driftNotify = opts.notifyFn;
    },
    getSendGrowthAlert: () => null,
    startProcessHealthMonitor: (opts) => {
      calls.push(['proc', opts.processName]);
      procNotify = opts.notifyFn;
    },
    startOntologyDailyDiagnosisScheduler: (pool) => { calls.push(['onto', pool.tag]); },
    startHealthCenterDailyScanScheduler: (pool) => { calls.push(['hc', pool.tag]); },
    startHealthOpsLoopScheduler: (pool) => { calls.push(['ops', pool.tag]); },
    startAiQualityLearningScheduler: (pool, handlers) => {
      calls.push(['ai', pool.tag, !!handlers.generateCandidate]);
    },
    aiQualityHandlers: { generateCandidate: async () => null, evaluateCandidate: async () => null },
    log: { error: (p) => { calls.push(['err', p.msg]); } },
    env: {},
  });
  await driftNotify('drift-msg');
  await procNotify('proc-msg');
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'lark' && c[1] === 'g'));
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'lark' && c[1] === 'h'));
  assert.ok(calls.some((c) => c === 'notif'));
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'ai'));
});

test('startBackgroundRuntimeMonitors prefers growth alert for drift', async () => {
  let driftNotify;
  const growth = async (msg, kind) => ({ msg, kind });
  startBackgroundRuntimeMonitors({
    registerProcessGuards: () => {},
    sendLarkMessage: async () => { throw new Error('should not use lark'); },
    FEISHU_ALERT_ADMIN_HEALTH: 'h',
    FEISHU_ALERT_ADMIN_GROWTH: 'g',
    createNotificationsCleanupScheduler: () => ({ startNotificationsCleanupScheduler: () => {} }),
    createFreshnessMonitorScheduler: () => ({ startFreshnessMonitorScheduler: () => {} }),
    pool: {},
    runForActiveTenants: async () => {},
    runFreshnessCheck: async () => {},
    FRESHNESS_SOURCES: [],
    startSchemaMigrationDriftMonitor: (_p, opts) => { driftNotify = opts.notifyFn; },
    getSendGrowthAlert: () => growth,
    startProcessHealthMonitor: () => {},
    startOntologyDailyDiagnosisScheduler: () => {},
    startHealthCenterDailyScanScheduler: () => {},
    startHealthOpsLoopScheduler: () => {},
    startAiQualityLearningScheduler: () => {},
    aiQualityHandlers: {},
    log: { error: () => {} },
    env: { AI_QUALITY_LLM_API_KEY: 'k', PM2_MAX_MEMORY_RESTART_BYTES: '100' },
  });
  const r = await driftNotify('x');
  assert.deepEqual(r, { msg: 'x', kind: 'schema_migration_drift' });
});
