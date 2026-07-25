/**
 * domains/health/pm2-exit-classify.js 纯函数单测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePm2ExitEvent,
  collectUnexpectedPm2Exits,
  parsePm2LogTimestampMs,
  scanPm2LogForUnexpectedExits,
  evaluateMemoryPressure,
} from '../domains/health/pm2-exit-classify.js';

test('parsePm2ExitEvent：非法行 → null；SIGINT code0 → intentional', () => {
  assert.equal(parsePm2ExitEvent(''), null);
  assert.equal(parsePm2ExitEvent('nope'), null);
  const ok = parsePm2ExitEvent('App [hrms-service:1102] exited with code [0] via signal [SIGINT]');
  assert.equal(ok.processName, 'hrms-service');
  assert.equal(ok.code, 0);
  assert.equal(ok.signal, 'SIGINT');
  assert.equal(ok.intentional, true);
  assert.equal(ok.kind, 'deploy_or_manual_stop');
});

test('parsePm2ExitEvent：SIGKILL / 非0 → unexpected_exit', () => {
  const kill = parsePm2ExitEvent('App [hrms-service] exited with code [0] via signal [SIGKILL]');
  assert.equal(kill.intentional, false);
  assert.equal(kill.kind, 'unexpected_exit');
  const crash = parsePm2ExitEvent('App [agents:1] exited with code [1] via signal [SIGINT]');
  assert.equal(crash.intentional, false);
  assert.equal(crash.code, 1);
});

test('collectUnexpectedPm2Exits：按 processName 过滤，跳过 intentional', () => {
  const lines = [
    'App [hrms-service] exited with code [0] via signal [SIGINT]',
    'App [hrms-service] exited with code [1] via signal [SIGTERM]',
    'App [other] exited with code [1] via signal [SIGTERM]',
  ];
  const all = collectUnexpectedPm2Exits(lines);
  assert.equal(all.length, 2);
  const only = collectUnexpectedPm2Exits(lines, { processName: 'hrms-service' });
  assert.equal(only.length, 1);
  assert.equal(only[0].processName, 'hrms-service');
  assert.equal(collectUnexpectedPm2Exits(null).length, 0);
});

test('parsePm2LogTimestampMs + scanPm2LogForUnexpectedExits：afterMs 过滤', () => {
  assert.equal(parsePm2LogTimestampMs('no ts'), null);
  const ts = parsePm2LogTimestampMs('2026-07-25T12:17:51: PM2 log');
  assert.ok(Number.isFinite(ts));

  const logText = [
    '2026-07-25T12:00:00: App [hrms-service] exited with code [1] via signal [SIGTERM]',
    '2026-07-25T12:17:51: App [hrms-service] exited with code [1] via signal [SIGKILL]',
    '2026-07-25T12:17:51: App [hrms-service] exited with code [0] via signal [SIGINT]',
    '2026-07-25T12:18:00: App [other] exited with code [1] via signal [SIGTERM]',
  ].join('\n');

  const after = Date.parse('2026-07-25T12:10:00');
  const hits = scanPm2LogForUnexpectedExits(logText, {
    processName: 'hrms-service',
    afterMs: after,
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].signal, 'SIGKILL');
});

test('evaluateMemoryPressure：低负载 ok；超压返回 ratio', () => {
  assert.deepEqual(evaluateMemoryPressure({ rssBytes: 0, maxMemoryRestartBytes: 100 }), { ok: true });
  assert.deepEqual(evaluateMemoryPressure({ rssBytes: 50, maxMemoryRestartBytes: 0 }), { ok: true });
  assert.equal(
    evaluateMemoryPressure({ rssBytes: 80, maxMemoryRestartBytes: 100, warnRatio: 0.85 }).ok,
    true
  );
  const hot = evaluateMemoryPressure({
    rssBytes: 90 * 1024 * 1024,
    maxMemoryRestartBytes: 100 * 1024 * 1024,
    warnRatio: 0.85,
  });
  assert.equal(hot.ok, false);
  assert.equal(hot.ratio, 0.9);
  assert.equal(hot.rssMb, 90);
  assert.equal(hot.limitMb, 100);
});
