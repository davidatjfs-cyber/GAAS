/**
 * PM2 退出分类 + 内存压线单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePm2ExitEvent,
  collectUnexpectedPm2Exits,
  scanPm2LogForUnexpectedExits,
  evaluateMemoryPressure,
  parsePm2LogTimestampMs,
} from '../domains/health/pm2-exit-classify.js';

test('parsePm2ExitEvent: SIGINT code0 = intentional', () => {
  const ev = parsePm2ExitEvent(
    '2026-07-25T12:17:51: PM2 log: App [hrms-service:1102] exited with code [0] via signal [SIGINT]'
  );
  assert.equal(ev.processName, 'hrms-service');
  assert.equal(ev.intentional, true);
  assert.equal(ev.kind, 'deploy_or_manual_stop');
});

test('parsePm2ExitEvent: SIGKILL = unexpected', () => {
  const ev = parsePm2ExitEvent(
    'App [hrms-service:1102] exited with code [0] via signal [SIGKILL]'
  );
  assert.equal(ev.intentional, false);
  assert.equal(ev.kind, 'unexpected_exit');
});

test('collectUnexpectedPm2Exits filters process + intentional', () => {
  const lines = [
    'App [hrms-service:1] exited with code [0] via signal [SIGINT]',
    'App [hrms-service:1] exited with code [1] via signal [SIGTERM]',
    'App [agents-service-v2:1] exited with code [1] via signal [SIGTERM]',
  ];
  const u = collectUnexpectedPm2Exits(lines, { processName: 'hrms-service' });
  assert.equal(u.length, 1);
  assert.equal(u[0].signal, 'SIGTERM');
});

test('scanPm2LogForUnexpectedExits respects afterMs', () => {
  const log = [
    '2026-07-25T10:00:00: PM2 log: App [hrms-service:1] exited with code [1] via signal [SIGTERM]',
    '2026-07-25T12:00:00: PM2 log: App [hrms-service:1] exited with code [1] via signal [SIGKILL]',
  ].join('\n');
  const after = Date.parse('2026-07-25T11:00:00');
  const hits = scanPm2LogForUnexpectedExits(log, {
    processName: 'hrms-service',
    afterMs: after,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].signal, 'SIGKILL');
  assert.ok(parsePm2LogTimestampMs(log.split('\n')[0]) > 0);
});

test('evaluateMemoryPressure', () => {
  assert.equal(
    evaluateMemoryPressure({ rssBytes: 100, maxMemoryRestartBytes: 800, warnRatio: 0.85 }).ok,
    true
  );
  const hot = evaluateMemoryPressure({
    rssBytes: 720 * 1024 * 1024,
    maxMemoryRestartBytes: 800 * 1024 * 1024,
    warnRatio: 0.85,
  });
  assert.equal(hot.ok, false);
  assert.ok(hot.ratio >= 0.85);
});
