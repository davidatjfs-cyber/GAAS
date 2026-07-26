import test from 'node:test';
import assert from 'node:assert/strict';
import { findStoreIndex, removeStoreFromList } from '../service.js';
import { STATE_PUT_WHITELIST, STATE_PUT_SERVER_OWNED, applyStatePutWhitelist } from '../../../hrms-state-put.js';

test('removeStoreFromList 按 id 删除', () => {
  const r = removeStoreFromList(
    [
      { id: 'store_1', name: '洪潮' },
      { id: 'store_2', name: '马己仙' },
    ],
    'store_1'
  );
  assert.equal(r.ok, true);
  assert.equal(r.removed.name, '洪潮');
  assert.equal(r.stores.length, 1);
  assert.equal(r.stores[0].id, 'store_2');
});

test('removeStoreFromList 支持按 name 兜底', () => {
  const r = removeStoreFromList([{ id: 'x', name: '洪潮' }], '洪潮');
  assert.equal(r.ok, true);
  assert.equal(findStoreIndex([{ id: 'a', name: 'b' }], 'missing'), -1);
});

test('stores 不在白名单且在 SERVER_OWNED', () => {
  assert.equal(STATE_PUT_WHITELIST.includes('stores'), false);
  assert.ok(STATE_PUT_SERVER_OWNED.includes('stores'));
});

test('PUT /api/state 不能覆盖 stores', () => {
  const existing = {
    stores: [{ id: 's1', name: '洪潮', latitude: 31.2 }],
    settings: { theme: 'old' },
  };
  const { next, ignoredKeys } = applyStatePutWhitelist(existing, {
    stores: [{ id: 'HACK', name: '被黑' }],
    settings: { theme: 'new' },
  });
  assert.deepEqual(next.stores, [{ id: 's1', name: '洪潮', latitude: 31.2 }]);
  assert.equal(next.settings.theme, 'new');
  assert.ok(ignoredKeys.includes('stores'));
});

test('brands / gmMailbox 不在白名单且 PUT 不能覆盖', () => {
  assert.equal(STATE_PUT_WHITELIST.includes('brands'), false);
  assert.equal(STATE_PUT_WHITELIST.includes('gmMailbox'), false);
  assert.ok(STATE_PUT_SERVER_OWNED.includes('brands'));
  assert.ok(STATE_PUT_SERVER_OWNED.includes('gmMailbox'));
  const existing = {
    brands: [{ id: 'b1', name: '洪潮' }],
    gmMailbox: [{ id: 'm1', subject: '旧' }],
  };
  const { next, ignoredKeys } = applyStatePutWhitelist(existing, {
    brands: [{ id: 'hack', name: '黑' }],
    gmMailbox: [{ id: 'hack', subject: '黑' }],
  });
  assert.deepEqual(next.brands, [{ id: 'b1', name: '洪潮' }]);
  assert.deepEqual(next.gmMailbox, [{ id: 'm1', subject: '旧' }]);
  assert.ok(ignoredKeys.includes('brands'));
  assert.ok(ignoredKeys.includes('gmMailbox'));
});
