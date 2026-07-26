/**
 * Agent 品牌运行时上下文（P2 peel from agents.js）。
 * 与 stores/brand-scope 隔离：本模块会按店名推断品牌，且不排序/不补默认 sop。
 */
import { BRAND_CONFIG, normalizeBrandId, getBrandsFromState } from './runtime-context-helpers.js';

/**
 * @param {object} deps
 * @param {Function} deps.getBrandConfigSync
 * @param {Function} deps.resolveTenantIdDefault
 * @param {Function} deps.inferBrandFromStoreName
 */
export function createAgentBrandRuntimeContext(deps) {
  const { getBrandConfigSync, resolveTenantIdDefault, inferBrandFromStoreName } = deps;

  function fallbackBrandConfigByName(brandName) {
    const name = String(brandName || '').trim();
    const brandKey = name.includes('马己仙') ? '马己仙' : '洪潮';
    const literal = BRAND_CONFIG[brandKey];
    const dbChecklist = getBrandConfigSync(brandKey, resolveTenantIdDefault())?.checklist;
    if (!dbChecklist) return literal;
    return {
      name: literal.name,
      fullName: literal.fullName,
      checkItems: {
        opening: dbChecklist.opening || literal.checkItems.opening,
        closing: dbChecklist.closing || literal.checkItems.closing,
      },
      standards: dbChecklist.standards || literal.standards,
    };
  }

  function getBrandRuntimeConfig(state0, brandContext) {
    const brandName = String(brandContext?.brandName || '').trim();
    const fallback = fallbackBrandConfigByName(brandName);
    const custom = brandContext?.brandConfig && typeof brandContext.brandConfig === 'object'
      ? brandContext.brandConfig
      : {};
    return {
      ...fallback,
      ...custom,
      scoreWeights: custom?.scoreWeights && typeof custom.scoreWeights === 'object'
        ? custom.scoreWeights
        : fallback.scoreWeights,
      sopKeypoints: Array.isArray(custom?.sopKeypoints) ? custom.sopKeypoints : [],
    };
  }

  function resolveBrandContextByStore(state0, storeRef) {
    const state = state0 && typeof state0 === 'object' ? state0 : {};
    const stores = Array.isArray(state?.stores) ? state.stores : [];
    const brands = getBrandsFromState(state);
    const byId = new Map(brands.map((b) => [String(b.id || ''), b]));
    const ref = String(storeRef || '').trim();
    const row = stores.find((s) => String(s?.id || '').trim() === ref || String(s?.name || '').trim() === ref) || null;
    const storeName = String(row?.name || ref || '').trim();
    const brandNameFromStore = String(row?.brand || row?.brandName || '').trim();
    const brandId = normalizeBrandId(row?.brandId || brandNameFromStore || inferBrandFromStoreName(storeName));
    const brand = byId.get(brandId) || null;
    const brandName = String(brand?.name || brandNameFromStore || inferBrandFromStoreName(storeName) || '').trim();
    const brandConfig = brand?.config && typeof brand.config === 'object' ? brand.config : {};
    return {
      storeId: String(row?.id || '').trim(),
      storeName,
      brandId,
      brandName,
      brandConfig,
    };
  }

  return {
    normalizeBrandId,
    getBrandsFromState,
    fallbackBrandConfigByName,
    getBrandRuntimeConfig,
    resolveBrandContextByStore,
  };
}

export { normalizeBrandId, getBrandsFromState, BRAND_CONFIG };
