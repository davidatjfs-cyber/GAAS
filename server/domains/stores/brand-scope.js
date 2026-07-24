export function normalizeBrandId(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function getBrandsFromState(state0) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  const existing = Array.isArray(state?.brands) ? state.brands : [];
  const map = new Map();

  existing.forEach((b) => {
    const name = String(b?.name || b?.label || '').trim();
    const id = normalizeBrandId(b?.id || b?.brandId || name);
    if (!name || !id) return;
    map.set(id, {
      id,
      name,
      config: b?.config && typeof b.config === 'object' ? b.config : {
        sopKeypoints: [],
        performanceWeights: {}
      }
    });
  });

  stores.forEach((s) => {
    const name = String(s?.brand || s?.brandName || '').trim();
    const id = normalizeBrandId(s?.brandId || name);
    if (!name || !id) return;
    if (!map.has(id)) {
      map.set(id, {
        id,
        name,
        config: { sopKeypoints: [], performanceWeights: {} }
      });
    }
  });

  return Array.from(map.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
}

export function resolveStoreBrandContext(state0, storeRef) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  const brands = getBrandsFromState(state);
  const byId = new Map(brands.map((b) => [String(b.id || ''), b]));
  const ref = String(storeRef || '').trim();
  const row = stores.find((s) => String(s?.id || '').trim() === ref || String(s?.name || '').trim() === ref) || null;
  const brandName = String(row?.brand || row?.brandName || '').trim();
  const brandId = normalizeBrandId(row?.brandId || brandName);
  const brand = byId.get(brandId) || (brandId && brandName
    ? { id: brandId, name: brandName, config: { sopKeypoints: [], performanceWeights: {} } }
    : null);
  return {
    storeId: String(row?.id || '').trim(),
    storeName: String(row?.name || '').trim(),
    brandId: String(brand?.id || brandId || '').trim(),
    brandName: String(brand?.name || brandName || '').trim(),
    brandConfig: brand?.config && typeof brand.config === 'object' ? brand.config : { sopKeypoints: [], performanceWeights: {} }
  };
}

export function getStoreNamesByBrand(state0, brandIdInput) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const brandId = normalizeBrandId(brandIdInput);
  if (!brandId) return [];
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  return stores
    .filter((s) => normalizeBrandId(s?.brandId || s?.brand || s?.brandName) === brandId)
    .map((s) => String(s?.name || '').trim())
    .filter(Boolean);
}

export function getStoreNamesByRegion(state0, regionInput) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const region = String(regionInput || '').trim();
  if (!region) return [];
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  return stores
    .filter((s) => String(s?.region || '').trim() === region)
    .map((s) => String(s?.name || '').trim())
    .filter(Boolean);
}

// 权限组/岗位的"门店范围"统一解析：全部/按品牌/按区域/按店多选 → 门店名称数组。
// 返回 null 表示这个权限组没有设置门店范围（caller 应该回退到原有的跨店绑定逻辑），
// 返回数组(可以是空数组)表示按这个范围来，不再看跨店绑定表——对没用到权限组的现有
// 租户(洪潮/马己仙)完全没有影响，因为他们的员工没有 permissionGroupId。
export function resolveStoreScopeStores(state0, scope) {
  if (!scope || typeof scope !== 'object') return null;
  const mode = String(scope.mode || '').trim();
  if (!mode || mode === 'legacy') return null;
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  if (mode === 'all') {
    return (Array.isArray(state?.stores) ? state.stores : [])
      .map((s) => String(s?.name || '').trim())
      .filter(Boolean);
  }
  if (mode === 'brand') return getStoreNamesByBrand(state, scope.brand);
  if (mode === 'region') return getStoreNamesByRegion(state, scope.region);
  if (mode === 'stores') {
    return Array.isArray(scope.stores) ? scope.stores.map((s) => String(s || '').trim()).filter(Boolean) : [];
  }
  return null;
}

export function buildKnowledgeBrandScopeTag(input) {
  const raw = String(input || '').trim();
  if (!raw || raw === 'all') return 'brand:all';
  const id = normalizeBrandId(raw);
  return id ? `brand:${id}` : 'brand:all';
}
