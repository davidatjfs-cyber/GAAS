import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBrandId,
  getBrandsFromState,
  BRAND_CONFIG,
} from '../runtime-context-helpers.js';
import { createAgentBrandRuntimeContext } from '../runtime-context.js';

test('normalizeBrandId cleans and slices', () => {
  assert.equal(normalizeBrandId(' 洪潮-品牌 '), '洪潮_品牌');
  assert.equal(normalizeBrandId(''), '');
});

test('getBrandsFromState preserves insertion order and skips dup store brands', () => {
  const brands = getBrandsFromState({
    brands: [{ id: 'hongchao', name: '洪潮', config: { a: 1 } }],
    stores: [
      { brand: '洪潮', brandId: 'hongchao' },
      { brand: '马己仙', brandId: 'majixian' },
    ],
  });
  assert.equal(brands.length, 2);
  assert.equal(brands[0].name, '洪潮');
  assert.deepEqual(brands[0].config, { a: 1 });
  assert.equal(brands[1].id, 'majixian');
});

test('resolveBrandContextByStore infers brand from unknown store name', () => {
  const api = createAgentBrandRuntimeContext({
    getBrandConfigSync: () => null,
    resolveTenantIdDefault: () => 'default',
    inferBrandFromStoreName: (name) => (String(name).includes('马己仙') ? '马己仙' : '洪潮'),
  });
  const ctx = api.resolveBrandContextByStore({}, '马己仙上海音乐广场店');
  assert.equal(ctx.storeName, '马己仙上海音乐广场店');
  assert.equal(ctx.brandName, '马己仙');
  assert.ok(ctx.brandId);
});

test('fallbackBrandConfigByName keeps literal when DB missing; overlays checklist when present', () => {
  const api = createAgentBrandRuntimeContext({
    getBrandConfigSync: () => null,
    resolveTenantIdDefault: () => 'default',
    inferBrandFromStoreName: () => '洪潮',
  });
  const lit = api.fallbackBrandConfigByName('洪潮');
  assert.equal(lit.fullName, BRAND_CONFIG['洪潮'].fullName);
  assert.deepEqual(lit.checkItems.opening, BRAND_CONFIG['洪潮'].checkItems.opening);

  const apiDb = createAgentBrandRuntimeContext({
    getBrandConfigSync: () => ({
      checklist: { opening: ['仅开门'], closing: ['仅关门'], standards: { quality: 'db' } },
    }),
    resolveTenantIdDefault: () => 'default',
    inferBrandFromStoreName: () => '洪潮',
  });
  const over = apiDb.fallbackBrandConfigByName('洪潮');
  assert.deepEqual(over.checkItems.opening, ['仅开门']);
  assert.equal(over.standards.quality, 'db');
  assert.equal(over.name, '洪潮');
});

test('getBrandRuntimeConfig merges custom scoreWeights and sopKeypoints', () => {
  const api = createAgentBrandRuntimeContext({
    getBrandConfigSync: () => null,
    resolveTenantIdDefault: () => 'default',
    inferBrandFromStoreName: () => '洪潮',
  });
  const cfg = api.getBrandRuntimeConfig({}, {
    brandName: '洪潮',
    brandConfig: { scoreWeights: { a: 1 }, sopKeypoints: ['k1'] },
  });
  assert.deepEqual(cfg.scoreWeights, { a: 1 });
  assert.deepEqual(cfg.sopKeypoints, ['k1']);
});
