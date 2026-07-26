/**
 * domains/inventory-forecast/scope.js — resolveForecastScope 四分支
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResolveForecastScope } from '../scope.js';

function makeResolve(overrides = {}) {
  return createResolveForecastScope({
    isForecastStoreScopedRole: (role) => role === 'store_manager',
    pickMyStoreFromState: () => '我的店',
    normalizeBrandId: (id) => String(id || '').trim().toLowerCase(),
    resolveStoreBrandContext: (_state, store) => ({
      storeName: store,
      brandId: store === 'A店' ? 'brand-a' : 'brand-x',
      brandName: store === 'A店' ? '品牌A' : '品牌X',
    }),
    getBrandsFromState: () => [{ id: 'Brand-B', name: '品牌B' }],
    getStoreNamesByBrand: () => ['B1店', 'B2店'],
    ...overrides,
  });
}

test('scopedRole：强制本人门店，忽略请求参数', () => {
  const resolve = makeResolve();
  const out = resolve({}, 'u1', 'store_manager', 'A店', 'Brand-B');
  assert.equal(out.store, '我的店');
  assert.equal(out.brandId, 'brand-x');
  assert.deepEqual(out.storeScope, ['我的店']);
});

test('非 scoped + qStore：按请求门店解析品牌', () => {
  const resolve = makeResolve();
  const out = resolve({}, 'u1', 'hq_manager', 'A店', '');
  assert.equal(out.store, 'A店');
  assert.equal(out.brandId, 'brand-a');
  assert.equal(out.brandName, '品牌A');
  assert.deepEqual(out.storeScope, ['A店']);
});

test('非 scoped + qBrandId：品牌范围多店', () => {
  const resolve = makeResolve();
  const out = resolve({}, 'u1', 'hq_manager', '', 'Brand-B');
  assert.equal(out.store, '');
  assert.equal(out.brandId, 'brand-b');
  assert.equal(out.brandName, '品牌B');
  assert.deepEqual(out.storeScope, ['B1店', 'B2店']);
});

test('全空：空 scope', () => {
  const resolve = makeResolve();
  const out = resolve({}, 'u1', 'hq_manager', '', '');
  assert.deepEqual(out, { store: '', brandId: '', brandName: '', storeScope: [] });
});

test('scoped 但无 myStore：storeScope 空数组', () => {
  const resolve = makeResolve({
    pickMyStoreFromState: () => '',
    resolveStoreBrandContext: () => ({ storeName: '', brandId: '', brandName: '' }),
  });
  const out = resolve({}, 'u1', 'store_manager', 'A店', '');
  assert.equal(out.store, '');
  assert.deepEqual(out.storeScope, []);
});
