export function createResolveForecastScope({
  isForecastStoreScopedRole,
  pickMyStoreFromState,
  normalizeBrandId,
  resolveStoreBrandContext,
  getBrandsFromState,
  getStoreNamesByBrand,
}) {
  function resolveForecastScope(state0, username, role, requestedStore, requestedBrandId) {
    const scopedRole = isForecastStoreScopedRole(role);
    const myStore = pickMyStoreFromState(state0, username);
    const qStore = String(requestedStore || '').trim();
    const qBrandId = normalizeBrandId(requestedBrandId);

    if (scopedRole) {
      const ctx = resolveStoreBrandContext(state0, myStore);
      const store = String(ctx.storeName || myStore || '').trim();
      return {
        store,
        brandId: normalizeBrandId(ctx.brandId),
        brandName: String(ctx.brandName || '').trim(),
        storeScope: store ? [store] : []
      };
    }

    if (qStore) {
      const ctx = resolveStoreBrandContext(state0, qStore);
      const store = String(ctx.storeName || qStore || '').trim();
      return {
        store,
        brandId: normalizeBrandId(ctx.brandId),
        brandName: String(ctx.brandName || '').trim(),
        storeScope: store ? [store] : []
      };
    }

    if (qBrandId) {
      const brands = getBrandsFromState(state0);
      const brand = brands.find((b) => normalizeBrandId(b?.id) === qBrandId) || null;
      return {
        store: '',
        brandId: qBrandId,
        brandName: String(brand?.name || '').trim(),
        storeScope: getStoreNamesByBrand(state0, qBrandId)
      };
    }

    return { store: '', brandId: '', brandName: '', storeScope: [] };
  }
  return resolveForecastScope;
}
