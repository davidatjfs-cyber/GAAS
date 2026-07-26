/**
 * domains/health/disk.js — createDiskPressureNotifier
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiskPressureNotifier } from '../disk.js';

test('maybeNotifyDiskPressureByLark：error/ok/无 openId 跳过；warn 发送；冷却；发送失败吞掉', async () => {
  const prev = process.env.HRMS_DISK_ALERT_OPEN_IDS;
  const sent = [];
  try {
    delete process.env.HRMS_DISK_ALERT_OPEN_IDS;
    const notify = createDiskPressureNotifier({
      sendLarkMessage: async (id, text) => {
        sent.push([id, text]);
      },
    });
    await notify({ error: 'x' });
    await notify({ level: 'ok' });
    await notify({ level: 'warn', message: '紧张', availGb: 10, totalGb: 100, usedPercent: 90 });
    assert.equal(sent.length, 0);

    process.env.HRMS_DISK_ALERT_OPEN_IDS = 'ou1, ou2';
    const notify2 = createDiskPressureNotifier({
      sendLarkMessage: async (id, text) => {
        if (id === 'ou2') throw new Error('fail');
        sent.push([id, text]);
      },
    });
    await notify2({
      level: 'warn',
      message: '紧张',
      availGb: 10,
      totalGb: 100,
      usedPercent: 90,
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 'ou1');
    assert.match(sent[0][1], /磁盘告警/);

    // cooldown: second warn within 24h skipped
    await notify2({
      level: 'warn',
      message: '紧张',
      availGb: 10,
      totalGb: 100,
      usedPercent: 90,
    });
    assert.equal(sent.length, 1);
  } finally {
    if (prev === undefined) delete process.env.HRMS_DISK_ALERT_OPEN_IDS;
    else process.env.HRMS_DISK_ALERT_OPEN_IDS = prev;
  }
});
