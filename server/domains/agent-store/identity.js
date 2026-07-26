/**
 * Agent 门店身份 / 匹配 API（P2 peel from agents.js）。
 * getSharedState 仍留在 agents.js（依赖 pool 生命周期）。
 */
import {
  findUserInState,
  isExactSameStore,
  isLikelySameStore,
  normalizeCanonicalStoreName as normalizeCanonicalStoreNameHelper,
  normalizeStoreAliasKey,
  normalizeStoreKey,
  normalizeStoreLike,
} from './identity-helpers.js';
import {
  inDateRangeInclusive,
  normProductKey,
  toDateOnly,
  toNum,
} from './value-helpers.js';

/**
 * @param {object} deps
 * @param {Function} deps.normalizeBrandId
 * @param {Function} deps.resolveBrandContextByStore
 * @param {Function} deps.inferBrandFromStoreName
 * @param {Array<{keywords: string[], canonical: string}>} deps.storeCanonicalMap
 */
export function createAgentStoreIdentity(deps) {
  const {
    normalizeBrandId,
    resolveBrandContextByStore,
    inferBrandFromStoreName,
    storeCanonicalMap,
  } = deps;

  function getStoresFromState(state) {
    const stores = Array.isArray(state?.stores) ? state.stores : [];
    return stores.map((s) => ({
      id: String(s?.id || '').trim(),
      name: String(s?.name || '').trim(),
      brand: String(s?.brand || s?.brandName || '').trim(),
      brandId: normalizeBrandId(s?.brandId || s?.brand || s?.brandName),
    })).filter((s) => s.name);
  }

  function resolveBrand(state, store) {
    const ctx = resolveBrandContextByStore(state, store);
    return ctx?.brandName || inferBrandFromStoreName(store) || '洪潮';
  }

  async function findStoreManager(state, storeName) {
    const all = [
      ...(Array.isArray(state?.employees) ? state.employees : []),
      ...(Array.isArray(state?.users) ? state.users : []),
    ];
    const normalizedStoreName = normalizeStoreKey(storeName);
    const mgr = all.find((u) =>
      normalizeStoreKey(u?.store) === normalizedStoreName
      && String(u?.role || '').trim() === 'store_manager');
    return mgr ? String(mgr.username || '').trim() : null;
  }

  function normalizeCanonicalStoreName(store) {
    return normalizeCanonicalStoreNameHelper(store, storeCanonicalMap);
  }

  return {
    findUserInState,
    getStoresFromState,
    resolveBrand,
    findStoreManager,
    normalizeStoreKey,
    normalizeStoreLike,
    normalizeCanonicalStoreName,
    normalizeStoreAliasKey,
    isExactSameStore,
    isLikelySameStore,
    toNum,
    toDateOnly,
    inDateRangeInclusive,
    normProductKey,
  };
}
