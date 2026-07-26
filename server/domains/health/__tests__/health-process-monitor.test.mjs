/**
 * domains/health/process-health-monitor.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  runProcessHealthBootCheck,
  runMemoryPressureCheck,
  startProcessHealthMonitor,
} from '../process-health-monitor.js';

test('runProcessHealthBootCheck：缺日志 / 无异常 / 有异常告警', async () => {
  const missing = await runProcessHealthBootCheck({
    pm2LogPath: path.join(os.tmpdir(), `no-such-pm2-${Date.now()}.log`),
    notifyFn: async () => {},
  });
  assert.equal(missing.skipped, true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-'));
  const logPath = path.join(dir, 'pm2.log');
  fs.writeFileSync(logPath, 'App [hrms-service] online\n', 'utf8');
  const ok = await runProcessHealthBootCheck({
    pm2LogPath: logPath,
    processName: 'hrms-service',
    lookbackMs: 60_000,
    nowMs: () => Date.now(),
    notifyFn: async () => {
      throw new Error('should_not');
    },
  });
  assert.equal(ok.ok, true);

  // 时间戳按本地拼，避免 toISOString(UTC) 与 Date.parse(无 Z=本地) 偏差导致被 lookback 滤掉
  const now = Date.now();
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  fs.writeFileSync(
    logPath,
    `${ts}: App [hrms-service] exited with code [1] via signal [SIGTERM]\n`,
    'utf8'
  );
  const notified = [];
  const bad = await runProcessHealthBootCheck({
    pm2LogPath: logPath,
    processName: 'hrms-service',
    lookbackMs: 60 * 60 * 1000,
    nowMs: () => now,
    notifyFn: async (msg) => {
      notified.push(msg);
      throw new Error('notify_fail');
    },
  });
  assert.equal(bad.ok, false);
  assert.ok(notified.length >= 1);
  assert.match(notified[0], /异常退出/);
});

test('runMemoryPressureCheck：ok / 压线告警', async () => {
  const ok = await runMemoryPressureCheck({
    maxMemoryRestartBytes: 1024 ** 3,
    getRssBytes: () => 100 * 1024 * 1024,
    notifyFn: async () => {},
  });
  assert.equal(ok.ok, true);

  const msgs = [];
  const press = await runMemoryPressureCheck({
    maxMemoryRestartBytes: 200 * 1024 * 1024,
    getRssBytes: () => 190 * 1024 * 1024,
    warnRatio: 0.5,
    notifyFn: async (m) => {
      msgs.push(m);
      throw new Error('n');
    },
  });
  assert.equal(press.ok, false);
  assert.ok(msgs[0].includes('内存压线'));
});

test('startProcessHealthMonitor：注册并执行 timeout/interval 回调', async () => {
  const timers = [];
  const realT = global.setTimeout;
  const realI = global.setInterval;
  global.setTimeout = (fn, ms) => {
    timers.push({ kind: 't', ms, fn });
    return 1;
  };
  global.setInterval = (fn, ms) => {
    timers.push({ kind: 'i', ms, fn });
    return 2;
  };
  const prevBoot = process.env.PROCESS_HEALTH_BOOT_DELAY_MS;
  const prevMem = process.env.PROCESS_HEALTH_MEM_INTERVAL_MS;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-mon-'));
  const logPath = path.join(dir, 'pm2.log');
  fs.writeFileSync(logPath, 'ok\n', 'utf8');
  const memNotifies = [];
  try {
    process.env.PROCESS_HEALTH_BOOT_DELAY_MS = '1000';
    process.env.PROCESS_HEALTH_MEM_INTERVAL_MS = '2000';
    startProcessHealthMonitor({
      pm2LogPath: logPath,
      processName: 'hrms-service',
      maxMemoryRestartBytes: 100 * 1024 * 1024,
      getRssBytes: () => 95 * 1024 * 1024,
      warnRatio: 0.5,
      notifyFn: async (m) => {
        memNotifies.push(m);
      },
    });
    assert.ok(timers.some((x) => x.kind === 't' && x.ms === 1000));
    assert.ok(timers.some((x) => x.kind === 'i' && x.ms === 2000));
    const bootFn = timers.find((x) => x.kind === 't')?.fn;
    const memFn = timers.find((x) => x.kind === 'i')?.fn;
    assert.equal(typeof bootFn, 'function');
    assert.equal(typeof memFn, 'function');
    await bootFn();
    await memFn();
    await memFn(); // cooldown 内第二次应被吞掉
    assert.ok(memNotifies.length >= 1);
  } finally {
    global.setTimeout = realT;
    global.setInterval = realI;
    if (prevBoot === undefined) delete process.env.PROCESS_HEALTH_BOOT_DELAY_MS;
    else process.env.PROCESS_HEALTH_BOOT_DELAY_MS = prevBoot;
    if (prevMem === undefined) delete process.env.PROCESS_HEALTH_MEM_INTERVAL_MS;
    else process.env.PROCESS_HEALTH_MEM_INTERVAL_MS = prevMem;
  }
});

test('runProcessHealthBootCheck：读日志失败返回 error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-bad-'));
  // 目录冒充文件路径：existsSync true，但 open/read 会失败
  const bad = await runProcessHealthBootCheck({
    pm2LogPath: dir,
    notifyFn: async () => {},
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.error);
});
