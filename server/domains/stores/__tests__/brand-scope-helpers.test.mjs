import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBrandId,
  getBrandsFromState,
  resolveStoreBrandContext,
  getStoreNamesByBrand,
  getStoreNamesByRegion,
  resolveStoreScopeStores,
  buildKnowledgeBrandScopeTag,
} from '../brand-scope.js';

test('normalizeBrandId: empty, punctuation collapse, chinese preserved, slice length', () => {
  assert.equal(normalizeBrandId(''), '');
  assert.equal(normalizeBrandId('   '), '');
  assert.equal(normalizeBrandId(null), '');
  assert.equal(normalizeBrandId(undefined), '');

  assert.equal(normalizeBrandId('Hong-Chao!!!Brand'), 'hong_chao_brand');
  assert.equal(normalizeBrandId('  __Foo--Bar__  '), 'foo_bar');

  assert.equal(normalizeBrandId('洪潮传统潮汕菜'), '洪潮传统潮汕菜');
  assert.equal(normalizeBrandId('Brand-洪潮'), 'brand_洪潮');

  const long = 'a'.repeat(100);
  assert.equal(normalizeBrandId(long).length, 80);
  assert.equal(normalizeBrandId(long), 'a'.repeat(80));
});

test('getBrandsFromState: merges brands + store-inferred brands, sort', () => {
  const state = {
    brands: [
      { id: 'zebra', name: '斑马品牌', config: { sopKeypoints: ['a'], performanceWeights: { x: 1 } } },
      { name: '苹果品牌' },
    ],
    stores: [
      { id: 's1', name: '店A', brand: '洪潮传统潮汕菜' },
      { id: 's2', name: '店B', brandId: 'zebra', brand: '斑马品牌' },
      { id: 's3', name: '店C', brandName: '香蕉品牌' },
    ],
  };
  const brands = getBrandsFromState(state);
  const names = brands.map((b) => b.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
  assert.ok(brands.some((b) => b.id === 'zebra' && b.name === '斑马品牌'));
  assert.ok(brands.some((b) => b.name === '洪潮传统潮汕菜'));
  assert.ok(brands.some((b) => b.name === '香蕉品牌'));
  assert.ok(brands.some((b) => b.name === '苹果品牌'));

  const zebra = brands.find((b) => b.id === 'zebra');
  assert.deepEqual(zebra.config, { sopKeypoints: ['a'], performanceWeights: { x: 1 } });

  assert.deepEqual(getBrandsFromState(null), []);
  assert.deepEqual(getBrandsFromState({}), []);
});

test('resolveStoreBrandContext: by store id and name', () => {
  const state = {
    brands: [{ id: 'hongchao', name: '洪潮传统潮汕菜', config: { sopKeypoints: ['k'], performanceWeights: {} } }],
    stores: [
      { id: 'store-1', name: '洪潮大宁久光店', brandId: 'hongchao', brand: '洪潮传统潮汕菜' },
      { id: 'store-2', name: '马己仙静安店', brand: '马己仙' },
    ],
  };

  const byId = resolveStoreBrandContext(state, 'store-1');
  assert.equal(byId.storeId, 'store-1');
  assert.equal(byId.storeName, '洪潮大宁久光店');
  assert.equal(byId.brandId, 'hongchao');
  assert.equal(byId.brandName, '洪潮传统潮汕菜');
  assert.deepEqual(byId.brandConfig, { sopKeypoints: ['k'], performanceWeights: {} });

  const byName = resolveStoreBrandContext(state, '马己仙静安店');
  assert.equal(byName.storeId, 'store-2');
  assert.equal(byName.storeName, '马己仙静安店');
  assert.equal(byName.brandId, '马己仙');
  assert.equal(byName.brandName, '马己仙');

  const missing = resolveStoreBrandContext(state, 'no-such-store');
  assert.equal(missing.storeId, '');
  assert.equal(missing.storeName, '');
  assert.equal(missing.brandId, '');
  assert.equal(missing.brandName, '');
});

test('getStoreNamesByBrand / getStoreNamesByRegion', () => {
  const state = {
    stores: [
      { name: '洪潮大宁久光店', brandId: 'hongchao', brand: '洪潮传统潮汕菜', region: '上海' },
      { name: '洪潮陆家嘴店', brand: '洪潮传统潮汕菜', region: '上海' },
      { name: '马己仙静安店', brandName: '马己仙', region: '上海' },
      { name: '洪潮杭州店', brandId: 'hongchao', region: '杭州' },
      { name: '', brandId: 'hongchao', region: '上海' },
    ],
  };

  // brandId 优先于 brand/brandName：有 brandId 的店不会靠中文品牌名匹配
  assert.deepEqual(getStoreNamesByBrand(state, 'hongchao'), [
    '洪潮大宁久光店',
    '洪潮杭州店',
  ]);
  assert.deepEqual(getStoreNamesByBrand(state, '洪潮传统潮汕菜'), [
    '洪潮陆家嘴店',
  ]);
  assert.deepEqual(getStoreNamesByBrand(state, ''), []);
  assert.deepEqual(getStoreNamesByBrand(state, null), []);

  assert.deepEqual(getStoreNamesByRegion(state, '上海'), [
    '洪潮大宁久光店',
    '洪潮陆家嘴店',
    '马己仙静安店',
  ]);
  assert.deepEqual(getStoreNamesByRegion(state, '杭州'), ['洪潮杭州店']);
  assert.deepEqual(getStoreNamesByRegion(state, ''), []);
  assert.deepEqual(getStoreNamesByRegion(state, '北京'), []);
});

test('resolveStoreScopeStores: null for missing/legacy, all/brand/region/stores modes', () => {
  const state = {
    stores: [
      { name: '洪潮大宁久光店', brandId: 'hongchao', region: '上海' },
      { name: '马己仙静安店', brand: '马己仙', region: '上海' },
      { name: '洪潮杭州店', brandId: 'hongchao', region: '杭州' },
    ],
  };

  assert.equal(resolveStoreScopeStores(state, null), null);
  assert.equal(resolveStoreScopeStores(state, undefined), null);
  assert.equal(resolveStoreScopeStores(state, 'not-object'), null);
  assert.equal(resolveStoreScopeStores(state, {}), null);
  assert.equal(resolveStoreScopeStores(state, { mode: '' }), null);
  assert.equal(resolveStoreScopeStores(state, { mode: 'legacy' }), null);
  assert.equal(resolveStoreScopeStores(state, { mode: 'unknown' }), null);

  assert.deepEqual(resolveStoreScopeStores(state, { mode: 'all' }), [
    '洪潮大宁久光店',
    '马己仙静安店',
    '洪潮杭州店',
  ]);
  assert.deepEqual(resolveStoreScopeStores(state, { mode: 'brand', brand: 'hongchao' }), [
    '洪潮大宁久光店',
    '洪潮杭州店',
  ]);
  assert.deepEqual(resolveStoreScopeStores(state, { mode: 'region', region: '上海' }), [
    '洪潮大宁久光店',
    '马己仙静安店',
  ]);
  assert.deepEqual(
    resolveStoreScopeStores(state, { mode: 'stores', stores: [' 店A ', '', '店B'] }),
    ['店A', '店B']
  );
  assert.deepEqual(resolveStoreScopeStores(state, { mode: 'stores' }), []);
});

test('buildKnowledgeBrandScopeTag: all / empty / brand id', () => {
  assert.equal(buildKnowledgeBrandScopeTag(''), 'brand:all');
  assert.equal(buildKnowledgeBrandScopeTag(null), 'brand:all');
  assert.equal(buildKnowledgeBrandScopeTag('all'), 'brand:all');
  assert.equal(buildKnowledgeBrandScopeTag('  ALL  '.toLowerCase()), 'brand:all');
  assert.equal(buildKnowledgeBrandScopeTag('hongchao'), 'brand:hongchao');
  assert.equal(buildKnowledgeBrandScopeTag('Hong-Chao'), 'brand:hong_chao');
  assert.equal(buildKnowledgeBrandScopeTag('洪潮'), 'brand:洪潮');
});
