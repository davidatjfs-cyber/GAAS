import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromotionRecipientsHelpers } from '../promotion-recipients.js';

const helpers = createPromotionRecipientsHelpers({
  pickStoreRoleUsernameByStore: (state, store, roles) => {
    const role = roles[0];
    const hit = (state.employees || []).find(
      (e) => e.store === store && e.role === role && e.status !== '离职'
    );
    return hit?.username || '';
  },
  pickHqManagerUsername: async () => 'hq1',
  uniqUsernames: (arr) => [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))],
  stateFindUserRecord: (state, u) =>
    (state.employees || []).find((e) => e.username === u) || null,
});

test('isKitchenByRoleOrPosition', () => {
  assert.equal(helpers.isKitchenByRoleOrPosition('store_production_manager', '', ''), true);
  assert.equal(helpers.isKitchenByRoleOrPosition('employee', '厨师长', ''), true);
  assert.equal(helpers.isKitchenByRoleOrPosition('employee', '服务员', '前厅'), false);
});

test('getPromotionTrackRecipients：后厨含出品经理', async () => {
  const state = {
    employees: [
      { username: 'alice', role: 'employee', store: '洪潮' },
      { username: 'mgr1', role: 'store_manager', store: '洪潮', status: 'active' },
      { username: 'prod1', role: 'store_production_manager', store: '洪潮', status: 'active' },
    ],
  };
  const kitchen = await helpers.getPromotionTrackRecipients(state, {
    applicantUsername: 'alice',
    mentorUsername: 'mentor1',
    store: '洪潮',
    currentPosition: '厨工',
    department: '后厨',
  });
  assert.ok(kitchen.includes('alice'));
  assert.ok(kitchen.includes('mentor1'));
  assert.ok(kitchen.includes('mgr1'));
  assert.ok(kitchen.includes('hq1'));
  assert.ok(kitchen.includes('prod1'));

  const front = await helpers.getPromotionTrackRecipients(state, {
    applicantUsername: 'alice',
    store: '洪潮',
    currentPosition: '服务员',
    department: '前厅',
  });
  assert.ok(front.includes('mgr1'));
  assert.equal(front.includes('prod1'), false);
});
