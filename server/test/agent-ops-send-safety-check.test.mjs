import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendSafetyCheck } from '../domains/agent-ops/send-safety-check.js';

function makeSender(overrides = {}) {
  const calls = { cards: [], messages: [] };
  const send = createSendSafetyCheck({
    getSharedState: async () => ({
      stores: [
        { name: '洪潮久光店', brand: '洪潮', manager: 'boss1' },
        { name: '马己仙店', brand: '马己仙', manager: 'boss2' },
      ],
      employees: [
        { username: 'mgr1', store: '洪潮久光店', role: 'store_manager' },
        { username: 'prod1', store: '洪潮久光店', role: 'store_production_manager' },
      ],
      users: [],
    }),
    isLikelySameStore: (a, b) => String(a) === String(b),
    normalizeStoreKey: (v) => String(v || '').trim(),
    lookupFeishuUserByUsername: async (u) =>
      u ? { open_id: `ou_${u}` } : null,
    sendLarkCard: async (openId, card) => {
      calls.cards.push({ openId, card });
      return { ok: true };
    },
    sendLarkMessage: async (openId, text) => {
      calls.messages.push({ openId, text });
      return { ok: true };
    },
    prefixWithAgentName: (_r, t) => `[ops] ${t}`,
    opsTaskReplyAuditLarkMd: '**系统审核要求**\n• 文字 ≥20 字',
    nowFn: () => Date.parse('2026-07-26T02:00:00.000Z'),
    randomFn: () => 0, // always first store
    ...overrides,
  });
  return { send, calls };
}

test('disabled config', async () => {
  const { send, calls } = makeSender();
  await send({ enabled: false });
  assert.equal(calls.cards.length, 0);
});

test('no stores', async () => {
  const { send, calls } = makeSender({
    getSharedState: async () => ({ stores: [], employees: [], users: [] }),
  });
  await send({});
  assert.equal(calls.cards.length, 0);
});

test('no matched store/brand', async () => {
  const { send, calls } = makeSender();
  await send({ store: '不存在' });
  assert.equal(calls.cards.length, 0);
});

test('sends card to assignees', async () => {
  const { send, calls } = makeSender();
  await send({ store: '洪潮久光店', description: '冷柜温度', type: '冷柜抽检', timeWindow: 10 });
  assert.equal(calls.cards.length, 2);
  assert.match(JSON.stringify(calls.cards[0].card), /冷柜抽检/);
  assert.match(JSON.stringify(calls.cards[0].card), /系统审核要求/);
});

test('card fail falls back to text message', async () => {
  const { send, calls } = makeSender({
    sendLarkCard: async () => ({ ok: false }),
    lookupFeishuUserByUsername: async (u) =>
      u === 'mgr1' ? { open_id: 'ou_mgr1' } : null,
  });
  await send({ store: '洪潮久光店' });
  assert.ok(calls.messages.some((m) => /随机抽检通知/.test(m.text)));
});

test('fallback to store.manager when no staff', async () => {
  const { send, calls } = makeSender({
    getSharedState: async () => ({
      stores: [{ name: '洪潮久光店', brand: '洪潮', manager: 'boss1' }],
      employees: [],
      users: [],
    }),
  });
  await send({ store: '洪潮久光店' });
  assert.equal(calls.cards.length, 1);
  assert.equal(calls.cards[0].openId, 'ou_boss1');
});

test('fallback card fail → text message', async () => {
  const { send, calls } = makeSender({
    getSharedState: async () => ({
      stores: [{ name: '洪潮久光店', brand: '洪潮', manager: 'boss1' }],
      employees: [],
      users: [],
    }),
    sendLarkCard: async () => ({ ok: false }),
  });
  await send({ store: '洪潮久光店' });
  assert.equal(calls.cards.length, 0);
  assert.ok(calls.messages.some((m) => m.openId === 'ou_boss1'));
});

test('fallback missing open_id → no send', async () => {
  const { send, calls } = makeSender({
    getSharedState: async () => ({
      stores: [{ name: '洪潮久光店', brand: '洪潮', manager: '' }],
      employees: [],
      users: [],
    }),
    lookupFeishuUserByUsername: async () => null,
  });
  await send({ store: '洪潮久光店' });
  assert.equal(calls.cards.length, 0);
});

test('brand filter + custom roles + replyExtra', async () => {
  const { send, calls } = makeSender({
    getSharedState: async () => ({
      stores: { a: { name: '洪潮久光店', brand: '洪潮' } },
      employees: [{ username: 'chef1', store: '洪潮久光店', role: 'chef' }],
      users: [],
    }),
  });
  await send({
    brand: '洪潮',
    assigneeRoles: ['chef'],
    replyHint: '请拍冷柜照片',
  });
  assert.equal(calls.cards.length, 1);
  assert.match(JSON.stringify(calls.cards[0].card), /本任务补充/);
  assert.match(JSON.stringify(calls.cards[0].card), /冷柜照片/);
});

test('all stores when no store/brand', async () => {
  const { send, calls } = makeSender({ randomFn: () => 0.9 }); // second store
  await send({});
  // second store 马己仙 has no staff → fallback boss2
  assert.ok(calls.cards.length >= 1);
});
