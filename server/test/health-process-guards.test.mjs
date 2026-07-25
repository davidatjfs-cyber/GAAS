/**
 * domains/health/process-guards.js 补充分支
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUnhandledRejectionHandler,
  createUncaughtExceptionHandler,
} from '../domains/health/process-guards.js';

test('unhandledRejection：非 Error reason；告警发送失败不抛', async () => {
  const calls = [];
  const handler = createUnhandledRejectionHandler({
    sendLarkMessage: async (...a) => {
      calls.push(a);
      throw new Error('lark_down');
    },
    FEISHU_ALERT_ADMIN_HEALTH: 'hc',
  });
  handler('string-reason', Promise.resolve());
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][1]), /string-reason/);
});

test('uncaughtException：告警后 process.exit(1)；lark 失败仍退出', async () => {
  const calls = [];
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => {
    exitCode = code;
  };
  try {
    const handler = createUncaughtExceptionHandler({
      sendLarkMessage: async (...a) => {
        calls.push(a);
        throw new Error('lark_fail');
      },
      FEISHU_ALERT_ADMIN_HEALTH: 'hc',
    });
    handler(new Error('crash'));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls.length, 1);
    assert.match(String(calls[0][1]), /crash/);
    assert.equal(exitCode, 1);

    exitCode = null;
    const handler2 = createUncaughtExceptionHandler({
      sendLarkMessage: async () => ({ ok: true }),
      FEISHU_ALERT_ADMIN_HEALTH: 'hc',
    });
    handler2('plain');
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(exitCode, 1);
  } finally {
    process.exit = origExit;
  }
});
