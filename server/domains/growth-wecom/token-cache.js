/**
 * In-memory WeCom access-token caches (P4 peel from growth-api.js).
 */

export function createWecomTokenCaches() {
  let growthCache = { token: '', expiresAt: 0, store_id: '' };
  const storeCaches = Object.create(null);

  return {
    getGrowthCache: () => growthCache,
    setGrowthCache: (next) => { growthCache = next; },
    getStoreCache: (storeId) => storeCaches[storeId],
    setStoreCache: (storeId, next) => { storeCaches[storeId] = next; },
    resetGrowthCache: () => {
      growthCache = { token: '', expiresAt: 0, store_id: '' };
    },
    clearStoreCache: (storeId) => {
      delete storeCaches[storeId];
    },
  };
}
