import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifyBitablePipelineFailure } from '../pipeline-failure-notify.js';

test('notifyBitablePipelineFailure dedupes and sends to admins', async () => {
  const sent = [];
  const notify = createNotifyBitablePipelineFailure({
    pool: () => ({
      query: async () => ({ rows: [{ open_id: 'ou_a' }, { open_id: 'ou_b' }] }),
    }),
    sendLarkMessage: async (openId, msg) => {
      sent.push({ openId, msg });
      return { ok: true };
    },
    log: { warn() {}, error() {} },
  });

  await notify('scope', new Error('boom'), { minIntervalMs: 60_000, dedupeKey: 'k1' });
  await notify('scope', new Error('boom2'), { minIntervalMs: 60_000, dedupeKey: 'k1' });
  assert.equal(sent.length, 2);
  assert.ok(sent.every((s) => s.msg.includes('Bitable 实时链故障')));
  assert.ok(sent.every((s) => s.msg.includes('boom')));
});

test('notifyBitablePipelineFailure warns when no recipients', async () => {
  const warns = [];
  const notify = createNotifyBitablePipelineFailure({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    sendLarkMessage: async () => ({ ok: true }),
    log: { warn: (...a) => warns.push(a), error() {} },
  });
  await notify('empty', 'x');
  assert.equal(warns.length, 1);
});
