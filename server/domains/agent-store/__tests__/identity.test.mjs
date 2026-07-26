import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findUserInState,
  isLikelySameStore,
  isExactSameStore,
  normalizeStoreLike,
  normalizeCanonicalStoreName,
} from '../identity-helpers.js';
import { toNum, toDateOnly, inDateRangeInclusive, normProductKey } from '../value-helpers.js';
import { createAgentStoreIdentity } from '../identity.js';

test('value helpers', () => {
  assert.equal(toNum('12.5'), 12.5);
  assert.equal(toNum('x', 3), 3);
  assert.equal(toDateOnly('2026-07-15'), '2026-07-15');
  assert.equal(inDateRangeInclusive('2026-07-15', '2026-07-01', '2026-07-31'), true);
  assert.equal(inDateRangeInclusive('2026-08-01', '2026-07-01', '2026-07-31'), false);
  assert.equal(normProductKey(' 红烧 肉 '), '红烧肉');
});

test('store match helpers', () => {
  assert.equal(isExactSameStore('洪潮店', '洪潮店'), true);
  assert.equal(isLikelySameStore('洪潮大宁久光店', '洪潮久光'), true);
  assert.equal(normalizeStoreLike('洪潮'), '%洪潮%');
  assert.equal(
    normalizeCanonicalStoreName('马己仙音乐广场', [
      { keywords: ['马己仙', '音乐广场'], canonical: '马己仙上海音乐广场店' },
    ]),
    '马己仙上海音乐广场店',
  );
});

test('findUserInState matches employees/users', () => {
  const state = {
    employees: [{ username: 'Alice', role: 'admin' }],
    users: [{ username: 'bob', role: 'store_manager' }],
  };
  assert.equal(findUserInState(state, 'alice')?.role, 'admin');
  assert.equal(findUserInState(state, 'bob')?.username, 'bob');
  assert.equal(findUserInState(state, ''), null);
});

test('factory getStoresFromState / findStoreManager / resolveBrand', async () => {
  const api = createAgentStoreIdentity({
    normalizeBrandId: (v) => String(v || '').toLowerCase().replace(/\s+/g, '_'),
    resolveBrandContextByStore: () => ({ brandName: '' }),
    inferBrandFromStoreName: (s) => (String(s).includes('马己仙') ? '马己仙' : '洪潮'),
    storeCanonicalMap: [],
  });
  const stores = api.getStoresFromState({
    stores: [{ id: '1', name: '洪潮店', brand: '洪潮' }, { name: '' }],
  });
  assert.equal(stores.length, 1);
  assert.equal(stores[0].brandId, '洪潮');
  assert.equal(api.resolveBrand({}, '马己仙店'), '马己仙');
  const mgr = await api.findStoreManager({
    employees: [
      { username: 'mgr1', store: '洪潮店', role: 'store_manager' },
      { username: 'pm1', store: '洪潮店', role: 'store_production_manager' },
    ],
  }, '洪潮店');
  assert.equal(mgr, 'mgr1');
});
