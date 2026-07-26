import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getBrandForStoreSync,
  getBrandConfigSync,
  getStoreHasTakeawaySync,
  getAllBrandKeysSync,
  getAllBrandNamesSync,
  clearBrandConfigCache,
} from './brand-config-loader.js';

// 不调用 initBrandConfigCache()，只验证 bootstrap 兜底与同步查找（与 store-alias-cache 测试策略一致）。

test('getBrandForStoreSync resolves store id, name, and brand substring', () => {
  const byId = getBrandForStoreSync('51866138');
  assert.equal(byId.brandKey, 'majixian');
  assert.equal(byId.storeName, '马己仙上海音乐广场店');
  assert.equal(byId.hasTakeaway, true);

  const byName = getBrandForStoreSync('洪潮大宁久光店');
  assert.equal(byName.brandKey, 'hongchao');
  assert.equal(byName.hasTakeaway, false);

  const bySubstring = getBrandForStoreSync('今天马己仙音乐广场店客流如何');
  assert.equal(bySubstring.brandKey, 'majixian');
});

test('getBrandForStoreSync scopes lookup by tenantId', () => {
  const scoped = getBrandForStoreSync('51866138', 'default');
  assert.equal(scoped.tenantId, 'default');
  assert.equal(getBrandForStoreSync('51866138', 'other-tenant'), null);
});

test('getBrandForStoreSync returns null for empty or unknown input', () => {
  assert.equal(getBrandForStoreSync(''), null);
  assert.equal(getBrandForStoreSync('不存在门店'), null);
});

test('getBrandConfigSync resolves brand key and Chinese name', () => {
  const byKey = getBrandConfigSync('hongchao');
  assert.equal(byKey.brandName, '洪潮');
  assert.equal(byKey.brandKey, 'hongchao');

  const byName = getBrandConfigSync('马己仙', 'default');
  assert.equal(byName.brandKey, 'majixian');
});

test('getStoreHasTakeawaySync matches exact store only', () => {
  assert.equal(getStoreHasTakeawaySync('51866138'), true);
  assert.equal(getStoreHasTakeawaySync('64822111'), false);
  assert.equal(getStoreHasTakeawaySync('马己仙'), null);
});

test('getAllBrandKeysSync and getAllBrandNamesSync return deduped lists', () => {
  const keys = getAllBrandKeysSync();
  assert.ok(keys.includes('hongchao'));
  assert.ok(keys.includes('majixian'));
  assert.equal(keys.length, new Set(keys).size);

  const names = getAllBrandNamesSync('default');
  assert.ok(names.includes('洪潮'));
  assert.ok(names.includes('马己仙'));
});

test('clearBrandConfigCache forces next lookup to trigger background refresh hook', () => {
  clearBrandConfigCache();
  const brand = getBrandForStoreSync('51866138');
  assert.equal(brand.brandKey, 'majixian');
});
