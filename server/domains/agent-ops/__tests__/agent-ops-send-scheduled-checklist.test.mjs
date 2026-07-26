import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendScheduledChecklist } from '../send-scheduled-checklist.js';

function makeSender(overrides = {}) {
  const calls = { cards: [], sql: [] };
  const send = createSendScheduledChecklist({
    pool: () => ({
      query: async (sql, params) => {
        calls.sql.push({ sql: String(sql), params });
        return { rows: [] };
      },
    }),
    getSharedState: async () => ({
      stores: [
        { name: '洪潮久光店', brand: '洪潮' },
        { name: '马己仙店', brand: '马己仙' },
      ],
      employees: [
        { username: 'mgr1', store: '洪潮久光店', role: 'store_manager' },
        { username: 'prod1', store: '洪潮久光店', role: 'store_production_manager' },
        { username: 'other', store: '马己仙店', role: 'store_manager' },
      ],
      users: [],
    }),
    isLikelySameStore: (a, b) => String(a) === String(b),
    normalizeStoreKey: (v) => String(v || '').trim(),
    lookupFeishuUserByUsername: async (u) =>
      u === 'mgr1' || u === 'prod1' ? { open_id: `ou_${u}` } : null,
    sendLarkCard: async (openId, card) => {
      calls.cards.push({ openId, card });
      return { ok: true, data: { data: { message_id: 'msg_1' } } };
    },
    formatChecklistTypeLabel: (t) =>
      ({ opening: '开市', closing: '收档', hygiene: '卫生巡检' }[t] || t || '巡检'),
    getOpsChecklistItems: () => ['卫生', '设备'],
    opsTaskReplyAuditLarkMd: '**系统审核要求**\n• 文字 ≥20 字',
    shouldSkipHrmsScheduledChecklist: () => false,
    nowFn: () => Date.parse('2026-07-26T02:00:00.000Z'),
    randomFn: () => 0.42,
    ...overrides,
  });
  return { send, calls };
}

test('skip when shouldSkip returns true', async () => {
  const { send, calls } = makeSender({
    shouldSkipHrmsScheduledChecklist: () => true,
  });
  await send({ store: '洪潮久光店', checkType: 'opening' });
  assert.equal(calls.cards.length, 0);
  assert.equal(calls.sql.length, 0);
});

test('no matching stores', async () => {
  const { send, calls } = makeSender();
  await send({ store: '不存在的店', checkType: 'opening' });
  assert.equal(calls.cards.length, 0);
});

test('brand filter sends to matching stores only', async () => {
  const { send, calls } = makeSender({
    lookupFeishuUserByUsername: async (u) =>
      u === 'mgr1' || u === 'other' ? { open_id: `ou_${u}` } : null,
  });
  await send({ brand: '洪潮', checkType: 'opening' });
  assert.ok(calls.cards.every((c) => c.openId === 'ou_mgr1' || c.openId === 'ou_prod1'));
  assert.ok(!calls.cards.some((c) => c.openId === 'ou_other'));
});

test('formUrl path creates card button + master_task', async () => {
  const { send, calls } = makeSender();
  await send({
    store: '洪潮久光店',
    brand: '洪潮',
    checkType: 'opening',
    formUrl: 'https://example.com/form',
    timeWindow: 30,
  });
  assert.ok(calls.cards.length >= 1);
  const card = calls.cards[0].card;
  assert.equal(card.header.template, 'blue');
  const btn = JSON.stringify(card.elements);
  assert.match(btn, /打开检查表/);
  assert.match(btn, /example\.com\/form/);
  assert.match(btn, /系统审核要求/);
  assert.ok(calls.sql.some((q) => /INSERT INTO master_tasks/.test(q.sql)));
  const row = calls.sql[0].params;
  assert.match(row[0], /^OPS-20260726-4200$/);
  assert.equal(row[2], 'scheduled_checklist');
  assert.equal(row[6], 'mgr1');
  assert.equal(row[10], JSON.stringify(['msg_1']));
});

test('closing uses orange header; default form url when empty formUrl', async () => {
  const { send, calls } = makeSender({
    lookupFeishuUserByUsername: async (u) =>
      u === 'mgr1' ? { open_id: 'ou_mgr1' } : null,
  });
  await send({ store: '洪潮久光店', checkType: 'closing', formUrl: '' });
  assert.equal(calls.cards[0].card.header.template, 'orange');
  assert.match(JSON.stringify(calls.cards[0].card), /feishu\.cn\/base/);
});

test('inline items when no default form url', async () => {
  const { send, calls } = makeSender({
    lookupFeishuUserByUsername: async (u) =>
      u === 'mgr1' ? { open_id: 'ou_mgr1' } : null,
  });
  await send({ store: '洪潮久光店', checkType: 'hygiene', formUrl: '' });
  const body = JSON.stringify(calls.cards[0].card);
  assert.match(body, /检查项目/);
  assert.match(body, /1\. 卫生/);
  assert.doesNotMatch(body, /打开检查表/);
});

test('empty checklist items fallback copy', async () => {
  const { send, calls } = makeSender({
    getOpsChecklistItems: () => [],
    lookupFeishuUserByUsername: async (u) =>
      u === 'mgr1' ? { open_id: 'ou_mgr1' } : null,
  });
  await send({ store: '洪潮久光店', checkType: 'hygiene', formUrl: '' });
  assert.match(JSON.stringify(calls.cards[0].card), /现场完成巡检/);
});

test('card fail skips master_task', async () => {
  const { send, calls } = makeSender({
    sendLarkCard: async () => ({ ok: false }),
  });
  await send({ store: '洪潮久光店', checkType: 'opening' });
  assert.equal(calls.sql.length, 0);
});

test('master_task insert error does not throw', async () => {
  const { send, calls } = makeSender({
    pool: () => ({
      query: async () => {
        throw new Error('db');
      },
    }),
  });
  await send({ store: '洪潮久光店', checkType: 'opening' });
  assert.ok(calls.cards.length >= 1);
});

test('per-store loop error is caught', async () => {
  const { send } = makeSender({
    lookupFeishuUserByUsername: async () => {
      throw new Error('lookup boom');
    },
  });
  await send({ store: '洪潮久光店', checkType: 'opening' });
});

test('no staff logs and sends nothing', async () => {
  const { send, calls } = makeSender({
    getSharedState: async () => ({
      stores: [{ name: '洪潮久光店', brand: '洪潮' }],
      employees: [],
      users: [],
    }),
  });
  await send({ store: '洪潮久光店', checkType: 'opening' });
  assert.equal(calls.cards.length, 0);
});

test('stores as object map still works', async () => {
  const { send, calls } = makeSender({
    getSharedState: async () => ({
      stores: { a: { name: '洪潮久光店', brand: '洪潮' } },
      employees: [{ username: 'mgr1', store: '洪潮久光店', role: 'store_manager' }],
      users: [],
    }),
    lookupFeishuUserByUsername: async () => ({ open_id: 'ou_x' }),
  });
  await send({ store: '洪潮久光店', checkType: 'opening', formUrl: 'https://x.test' });
  assert.equal(calls.cards.length, 1);
});
