/**
 * domains/growth-sms/reconcile.js 补充分支
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runSmsTemplateReconcile,
  registerSmsReconcileJob,
} from '../domains/growth-sms/reconcile.js';

test('runSmsTemplateReconcile：远程 status≠1；全一致 ok；空 content 跳过', async () => {
  let alerted = 0;
  const badStatus = await runSmsTemplateReconcile(
    {},
    {
      listSmsTemplates: async () => [
        { template_code: 'SMS_X', brand_suffix: 'a', slot: '1', content: '正文' },
        { template_code: '', content: 'ignore' },
        { template_code: 'SMS_Y', brand_suffix: 'a', slot: '1', content: '' },
      ],
      querySmsTemplate: async (code) => {
        if (code === 'SMS_X') return { status: 0, reason: '审核中', content: '正文' };
        return { status: 1, content: 'x' };
      },
      getSendGrowthAlert: () => async () => {
        alerted += 1;
      },
    }
  );
  assert.equal(badStatus.mismatches, 1);
  assert.equal(alerted, 1);

  const ok = await runSmsTemplateReconcile(
    {},
    {
      listSmsTemplates: async () => [
        { template_code: 'SMS_Z', brand_suffix: 'a', slot: '1', content: 'hello ${n}' },
      ],
      querySmsTemplate: async () => ({ status: 1, content: 'hello${n}' }),
      getSendGrowthAlert: () => async () => {
        alerted += 1;
      },
    }
  );
  assert.equal(ok.mismatches, 0);
  assert.equal(ok.checked, 1);
});

test('registerSmsReconcileJob：幂等注册 interval+timeout', async () => {
  const prev = globalThis.__smsReconcileTimer;
  delete globalThis.__smsReconcileTimer;
  const timers = [];
  const realInterval = global.setInterval;
  const realTimeout = global.setTimeout;
  global.setInterval = (fn, ms) => {
    timers.push({ kind: 'interval', fn, ms });
    return 99;
  };
  global.setTimeout = (fn, ms) => {
    timers.push({ kind: 'timeout', fn, ms });
    return 100;
  };
  try {
    const pool = {};
    registerSmsReconcileJob(pool);
    registerSmsReconcileJob(pool);
    assert.equal(globalThis.__smsReconcileTimer, 99);
    assert.equal(timers.filter((t) => t.kind === 'interval').length, 1);
    assert.equal(timers.filter((t) => t.kind === 'timeout').length, 1);
    assert.equal(timers.find((t) => t.kind === 'interval').ms, 24 * 60 * 60 * 1000);
    assert.equal(timers.find((t) => t.kind === 'timeout').ms, 10 * 60 * 1000);
  } finally {
    global.setInterval = realInterval;
    global.setTimeout = realTimeout;
    if (prev === undefined) delete globalThis.__smsReconcileTimer;
    else globalThis.__smsReconcileTimer = prev;
  }
});