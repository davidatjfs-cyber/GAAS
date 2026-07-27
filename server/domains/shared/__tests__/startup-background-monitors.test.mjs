import test from 'node:test';
import assert from 'node:assert/strict';
import { startBackgroundRuntimeMonitors } from '../startup-background-monitors.js';

test('startBackgroundRuntimeMonitors wires guards/schedulers/AI quality', () => {
  const calls = [];
  startBackgroundRuntimeMonitors({
    registerProcessGuards: (d) => { calls.push(['guards', !!d.sendLarkMessage]); },
    sendLarkMessage: async () => {},
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
      assert.equal(typeof opts.notifyFn, 'function');
    },
    getSendGrowthAlert: () => null,
    startProcessHealthMonitor: (opts) => {
      calls.push(['proc', opts.processName]);
      assert.equal(typeof opts.notifyFn, 'function');
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
  assert.ok(calls.some((c) => c === 'notif'));
  assert.ok(calls.some((c) => c === 'fresh'));
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'ai'));
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === 'err' && c[1] === 'ai_quality_llm_api_key_missing'));
});
