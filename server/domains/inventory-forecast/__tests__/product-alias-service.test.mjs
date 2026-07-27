import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listProductAliases,
  createProductAlias,
  updateProductAlias,
  deleteProductAlias,
} from '../product-alias-service.js';

function baseCtx(overrides = {}) {
  return {
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    canManageGrossProfitProfiles: (role) => role === 'admin',
    resolveForecastScope: (_state, _username, _role, store, brandId) => ({
      store: String(store || '').trim(),
      brandId: String(brandId || (store === 'A店' || store === 'B店' ? 'brand-a' : 'brand-b')).trim(),
      brandName: '测试品牌',
      storeScope: store ? [store] : [],
    }),
    normalizeBrandId: (value) => String(value || '').trim().toLowerCase(),
    resolveStoreBrandContext: (_state, store) => ({
      brandId: store === 'A店' || store === 'B店' ? 'brand-a' : 'brand-b',
      brandName: '测试品牌',
    }),
    normalizeProductName: (value) => String(value || '').trim().toLowerCase(),
    hrmsNowISO: () => '2026-07-27T00:00:00.000Z',
    ...overrides,
  };
}

test('listProductAliases: 仅返回当前品牌并按名称排序', async () => {
  const result = await listProductAliases(baseCtx({
    getSharedState: async () => ({
      forecastProductAliasRules: [
        { id: 'b', brandId: 'brand-a', canonical: '牛腩' },
        { id: 'other', brandId: 'brand-b', canonical: '鲈鱼' },
        { id: 'a', brandId: 'brand-a', canonical: '叉烧' },
      ],
    }),
  }), {
    username: 'admin',
    role: 'admin',
    query: { store: 'A店' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.brandId, 'brand-a');
  assert.deepEqual(result.items.map((item) => item.id), ['a', 'b']);
});

test('createProductAlias: 创建成功并保留状态写入语义', async () => {
  let saved = null;
  const result = await createProductAlias(baseCtx({
    getSharedState: async () => ({ preserved: true, forecastProductAliasRules: [] }),
    saveSharedState: async (state) => { saved = state; },
  }), {
    username: 'admin',
    role: 'admin',
    body: { store: 'A店', canonical: '招牌牛腩', aliases: ['牛腩'] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.item.brandId, 'brand-a');
  assert.deepEqual(result.item.aliases, ['牛腩']);
  assert.equal(saved.preserved, true);
  assert.deepEqual(saved.forecastProductAliasRules, [result.item]);
});

test('createProductAlias: 同品牌跨门店重复别名拒绝', async () => {
  const result = await createProductAlias(baseCtx({
    getSharedState: async () => ({
      forecastProductAliasRules: [{
        id: 'existing',
        brandId: 'brand-a',
        store: 'A店',
        canonical: '招牌牛腩',
        aliases: ['牛腩'],
      }],
    }),
  }), {
    username: 'admin',
    role: 'admin',
    body: { store: 'B店', canonical: '精品牛腩', aliases: ['牛腩'] },
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: 'duplicate_alias',
    message: '名称「牛腩」已被其他规则使用',
  });
});

test('updateProductAlias: 排除自身后允许原名称更新', async () => {
  let saved = null;
  const result = await updateProductAlias(baseCtx({
    getSharedState: async () => ({
      forecastProductAliasRules: [{
        id: 'self',
        brandId: 'brand-a',
        store: 'A店',
        canonical: '招牌牛腩',
        aliases: ['牛腩'],
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    }),
    saveSharedState: async (state) => { saved = state; },
  }), {
    username: 'admin',
    role: 'admin',
    params: { id: 'self' },
    body: { canonical: '招牌牛腩', aliases: ['牛腩'] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.item.id, 'self');
  assert.equal(saved.forecastProductAliasRules[0].updatedBy, 'admin');
});

test('deleteProductAlias: 缺失规则返回 not_found 且不写状态', async () => {
  let writes = 0;
  const result = await deleteProductAlias(baseCtx({
    getSharedState: async () => ({ forecastProductAliasRules: [] }),
    saveSharedState: async () => { writes += 1; },
  }), {
    username: 'admin',
    role: 'admin',
    params: { id: 'missing' },
  });

  assert.deepEqual(result, { ok: false, status: 404, error: 'not_found' });
  assert.equal(writes, 0);
});
