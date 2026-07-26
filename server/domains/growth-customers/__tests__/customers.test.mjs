import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertCustomer } from '../upsert.js';
import { autoBackfillSmsActions } from '../sms-backfill.js';
import { backfillRedemptionAmounts } from '../redemption-backfill.js';
import {
  confidenceFromReach,
  scoreSmsBackfillOutcome,
} from '../sms-backfill-helpers.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

function queuePool(handlers) {
  let i = 0;
  return {
    query: async (sql, params) => {
      const next = handlers[i++];
      if (!next) throw new Error(`unexpected query #${i}: ${String(sql).slice(0, 80)}`);
      if (typeof next === 'function') return next(sql, params);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('scoreSmsBackfillOutcome / confidenceFromReach', () => {
  assert.equal(confidenceFromReach(120), 'high');
  assert.equal(confidenceFromReach(40), 'medium');
  assert.equal(confidenceFromReach(5), 'low');

  const none = scoreSmsBackfillOutcome({ reach: 10, redemptions: 1, revenue_fen: 1000 });
  assert.equal(none.effectiveness, '已回填');
  assert.equal(none.score, null);

  const win = scoreSmsBackfillOutcome({
    reach: 100,
    redemptions: 50,
    revenue_fen: 50000,
    expected: { reach: 100, redemption_rate: 40, revenue_fen: 40000 },
  });
  assert.equal(win.effectiveness, '有效');
  assert.ok(win.score >= 70);

  const weak = scoreSmsBackfillOutcome({
    reach: 100,
    redemptions: 5,
    revenue_fen: 1000,
    expected: { reach: 100, redemption_rate: 50, revenue_fen: 50000 },
  });
  assert.ok(['部分有效', '无效'].includes(weak.effectiveness));
});

test('upsertCustomer: null without identity; insert + identities', async () => {
  assert.equal(await upsertCustomer(queuePool([]), {}, 'default', { cleanText, cleanPhone }), null);

  const pool = queuePool([
    { rows: [] }, // phone miss
    { rows: [{ id: 9, phone: '13800000000' }] }, // insert
    { rows: [] }, // identity
  ]);
  const row = await upsertCustomer(pool, {
    phone: '138-0000-0000',
    store_id: 's1',
    customer_meta: { a: 1 },
  }, 'default', { cleanText, cleanPhone });
  assert.equal(row.id, 9);
});

test('upsertCustomer: update existing + openid conflict release', async () => {
  const pool = queuePool([
    { rows: [{ id: 1, phone: '139', openid: 'old' }] }, // phone match
    { rows: [{ id: 2 }] }, // openid conflict owner
    { rows: [] }, // release openid
    { rows: [{ id: 1, phone: '139', openid: 'new' }] }, // update
    { rows: [] }, // identity phone
    { rows: [] }, // identity openid
  ]);
  const row = await upsertCustomer(pool, {
    phone: '139',
    openid: 'new',
  }, 't1', { cleanText, cleanPhone });
  assert.equal(row.openid, 'new');
});

test('upsertCustomer: find by openid when no phone match', async () => {
  const pool = queuePool([
    { rows: [{ id: 3, openid: 'oid' }] },
    { rows: [{ id: 3, openid: 'oid', phone: '1' }] },
    { rows: [] },
  ]);
  const row = await upsertCustomer(pool, { openid: 'oid' }, 'default', { cleanText, cleanPhone });
  assert.equal(row.id, 3);
});

test('backfillRedemptionAmounts returns matched count', async () => {
  const pool = queuePool([
    { rows: [{ id: 1 }, { id: 2 }] },
    { rows: [] },
  ]);
  assert.equal(await backfillRedemptionAmounts(pool), 2);
});

test('backfillRedemptionAmounts ignores events update failure', async () => {
  const pool = queuePool([
    { rows: [{ id: 1 }] },
    new Error('events down'),
  ]);
  assert.equal(await backfillRedemptionAmounts(pool), 1);
});

test('autoBackfillSmsActions scores and writes learning', async () => {
  const warns = [];
  const pool = queuePool([
    {
      rows: [{
        action_key: 'ak1',
        store_id: 'storeA',
        payload: {
          expected_kpi: { reach: 10, redemption_rate: 20, revenue_fen: 1000 },
          ready_copy: '文案A',
          target_audience: '沉睡',
        },
      }],
    },
    { rows: [{ reach: 10, first_sent: '2026-01-01T00:00:00Z' }] },
    { rows: [{ redemptions: 5, revenue_fen: 2000 }] },
    { rows: [] },
    { rows: [] },
  ]);
  const n = await autoBackfillSmsActions(pool, {
    cleanText,
    resolveTenantIdDefault: () => 'default',
    log: { warn: (x) => warns.push(x) },
  });
  assert.equal(n, 1);
  assert.equal(warns.length, 0);
});

test('autoBackfillSmsActions skips zero reach and logs per-action errors', async () => {
  const warns = [];
  const pool = queuePool([
    {
      rows: [
        { action_key: 'ak0', store_id: 's', payload: {} },
        { action_key: 'akErr', store_id: 's', payload: {} },
      ],
    },
    { rows: [{ reach: 0, first_sent: null }] },
    new Error('boom'),
  ]);
  const n = await autoBackfillSmsActions(pool, {
    cleanText,
    resolveTenantIdDefault: () => 'default',
    log: { warn: (x) => warns.push(x) },
  });
  assert.equal(n, 0);
  assert.equal(warns[0].msg, 'sms_backfill_action_error');
});
