import test from 'node:test';
import assert from 'node:assert/strict';
import { createTryCaptureOpsChecklistDetailFromChat } from '../capture-checklist-detail.js';

test('tryCaptureOpsChecklistDetailFromChat updates remark/photos', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const key = `ou_1||洪潮店||opening||${today}`;
  const progress = {
    pendingItemIndex: 0,
    pendingItemName: '冰箱温度',
    itemDetails: {},
  };
  const map = new Map([[key, progress]]);
  const sent = [];
  const capture = createTryCaptureOpsChecklistDetailFromChat({
    opsChecklistProgress: map,
    countOpsChecklistAbnormal: () => 1,
    sendLarkMessage: async (openId, text) => {
      sent.push({ openId, text });
    },
    prefixWithAgentName: (_r, t) => t,
  });

  assert.deepEqual(await capture('', { store: '洪潮店' }, 'x'), { handled: false });
  assert.deepEqual(await capture('ou_1', { store: '洪潮店' }, ''), { handled: false });

  const r = await capture('ou_1', { store: '洪潮店' }, '说明：偏高', ['http://img/1']);
  assert.equal(r.handled, true);
  assert.equal(progress.itemDetails[0].remark, '偏高');
  assert.equal(progress.itemDetails[0].photoCount, 1);
  assert.match(sent[0].text, /冰箱温度/);
});
