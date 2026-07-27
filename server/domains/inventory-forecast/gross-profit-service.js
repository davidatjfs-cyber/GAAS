/**
 * Inventory forecast gross-profit profile CRUD + margin estimation. Returns { ok, status?, error?, ...payload }.
 */
import { childLogger } from '../../utils/logger.js';
import {
  loadGrossProfitHistory,
  mergeDishLibraryCosts,
} from './gross-profit-helpers.js';

const log = childLogger({ domain: 'inventory-forecast', handler: 'gross-profit-service' });

export async function listGrossProfitProfiles(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

  const qBizType = ctx.normalizeForecastBizType(input.query?.bizType);
  try {
    const state0 = (await ctx.getSharedState()) || {};
    const scope = ctx.resolveForecastScope(state0, username, role, input.query?.store, input.query?.brandId);
    if (!scope.brandId || !scope.storeScope.length) return { ok: false, status: 400, error: 'missing_brand_or_store_scope' };

    let items = Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles.slice() : [];
    items = items.filter((x) => {
      const rid = ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
      return rid === scope.brandId;
    });
    if (qBizType) items = items.filter((x) => String(x?.bizType || '').trim() === qBizType || !String(x?.bizType || '').trim());

    items = await mergeDishLibraryCosts(ctx, items, scope, { includeSource: true, log });

    items.sort((a, b) => String(a?.product || '').localeCompare(String(b?.product || ''), 'zh-Hans-CN'));

    // Enrich with avg price from history for margin rate computation
    const today = new Date().toISOString().slice(0, 10);
    const historyRows = await loadGrossProfitHistory(ctx, state0, scope, {
      bizType: qBizType || '',
      startDate: ctx.shiftForecastDate(today, -180),
      endDate: today,
      filterStateByRange: false,
    });
    const aliasLookup = ctx.buildForecastProductAliasLookup(state0, { store: scope.store, brandId: scope.brandId });
    const priceMap = ctx.computeAvgPricePerProduct(historyRows, scope.storeScope, aliasLookup);
    const enriched = items.map((x) => {
      const avgPrice = priceMap.get(ctx.resolveForecastProductName(String(x?.product || '').trim(), aliasLookup).key) || 0;
      const cost = Number(x?.costPerUnit || 0);
      const gpu = Number.isFinite(x?.grossPerUnit) ? x.grossPerUnit : (avgPrice > cost && cost > 0 ? avgPrice - cost : 0);
      const marginRate = avgPrice > 0 && cost > 0 ? Number((1 - cost / avgPrice).toFixed(4)) : (gpu > 0 && avgPrice > 0 ? Number((gpu / avgPrice).toFixed(4)) : 0);
      return { ...x, avgPrice: Number(avgPrice.toFixed(2)), marginRate };
    });
    return { ok: true, store: scope.store || '', brandId: scope.brandId, brandName: scope.brandName, bizType: qBizType || '', items: enriched };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function upsertGrossProfitProfiles(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可配置产品毛利' };

  // Support single item add: {store, product, costPerUnit} or batch: {store, items:[...]}
  const singleProduct = String(input.body?.product || '').trim();
  const itemsRaw = singleProduct
    ? [{ product: singleProduct, costPerUnit: input.body?.costPerUnit, grossPerUnit: input.body?.grossPerUnit, bizType: input.body?.bizType }]
    : (Array.isArray(input.body?.items) ? input.body.items : []);
  const replace = !!input.body?.replace;
  if (!itemsRaw.length) return { ok: false, status: 400, error: 'missing_items' };
  try {
    const state0 = (await ctx.getSharedState()) || {};
    const scope = ctx.resolveForecastScope(state0, username, role, input.body?.store, input.body?.brandId);
    if (!scope.brandId || !scope.storeScope.length) return { ok: false, status: 400, error: 'missing_brand_or_store_scope' };

    const now = ctx.hrmsNowISO();
    const normalizedItems = itemsRaw.map(ctx.normalizeGrossProfitProfileItem).filter(Boolean);
    if (!normalizedItems.length) return { ok: false, status: 400, error: 'invalid_items' };

    // Compute avg prices for cost→gross conversion
    const today = new Date().toISOString().slice(0, 10);
    const historyRows = await loadGrossProfitHistory(ctx, state0, scope, {
      startDate: ctx.shiftForecastDate(today, -180),
      endDate: today,
      filterStateByRange: false,
    });
    const aliasLookup = ctx.buildForecastProductAliasLookup(state0, { store: scope.store, brandId: scope.brandId });
    const priceMap = ctx.computeAvgPricePerProduct(historyRows, scope.storeScope, aliasLookup);

    let all = Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles.slice() : [];
    if (replace) {
      all = all.filter((x) => {
        const rid = ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
        return rid !== scope.brandId;
      });
    }

    // Check product uniqueness within this store (product name must be unique)
    const existingProducts = new Map();
    all
      .filter((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === scope.brandId)
      .forEach((x) => existingProducts.set(String(x?.product || '').trim(), x));

    const keyOf = (x) => `${ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId)}||${String(x?.product || '').trim()}`;
    const map = new Map(all.map((x) => [keyOf(x), x]));

    normalizedItems.forEach((it) => {
      const canonicalProduct = ctx.resolveForecastProductName(it.product, aliasLookup).display;
      const key = `${scope.brandId}||${canonicalProduct}`;
      const prev = map.get(key);
      const avgPrice = priceMap.get(ctx.resolveForecastProductName(canonicalProduct, aliasLookup).key) || 0;
      let gpu = it.grossPerUnit;
      if ((!Number.isFinite(gpu) || gpu === undefined) && Number.isFinite(it.costPerUnit)) {
        gpu = avgPrice > it.costPerUnit ? Number((avgPrice - it.costPerUnit).toFixed(4)) : 0;
      }
      map.set(key, {
        ...(prev || {}),
        id: prev?.id || ctx.randomUUID(),
        store: prev?.store || scope.storeScope[0] || scope.store || '',
        brandId: scope.brandId,
        brandName: scope.brandName,
        bizType: it.bizType || '',
        product: canonicalProduct,
        costPerUnit: Number.isFinite(it.costPerUnit) ? it.costPerUnit : (prev?.costPerUnit || undefined),
        grossPerUnit: Number.isFinite(gpu) ? Number(gpu.toFixed(4)) : (prev?.grossPerUnit || 0),
        createdAt: prev?.createdAt || now,
        createdBy: prev?.createdBy || username,
        updatedAt: now,
        updatedBy: username
      });
    });

    const nextItems = Array.from(map.values()).slice(0, 8000);
    await ctx.saveSharedState({ ...state0, forecastGrossProfitProfiles: nextItems });
    return { ok: true, brandId: scope.brandId, brandName: scope.brandName, count: normalizedItems.length, total: nextItems.filter((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === scope.brandId).length };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function updateGrossProfitProfile(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可修改产品毛利' };

  const id = String(input.params?.id || '').trim();
  if (!id) return { ok: false, status: 400, error: 'missing_id' };

  try {
    const state0 = (await ctx.getSharedState()) || {};
    let all = Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles.slice() : [];
    const idx = all.findIndex((x) => String(x?.id || '').trim() === id);
    if (idx < 0) return { ok: false, status: 404, error: 'not_found' };

    const existing = all[idx];
    const store = String(existing?.store || '').trim();
    const brandId = ctx.normalizeBrandId(existing?.brandId || ctx.resolveStoreBrandContext(state0, store).brandId);
    const brandName = String(existing?.brandName || ctx.resolveStoreBrandContext(state0, store).brandName || '').trim();
    const storeScope = ctx.getStoreNamesByBrand(state0, brandId);
    const now = ctx.hrmsNowISO();

    // Updatable fields
    const aliasLookup = ctx.buildForecastProductAliasLookup(state0, { store, brandId });
    const newProductRaw = String(input.body?.product || '').trim() || existing.product;
    const newProduct = ctx.resolveForecastProductName(newProductRaw, aliasLookup).display;
    const newCost = input.body?.costPerUnit !== undefined ? ctx.safeNumber(input.body.costPerUnit) : existing.costPerUnit;
    const newBizType = input.body?.bizType !== undefined ? (ctx.normalizeForecastBizType(input.body.bizType) || '') : (existing.bizType || '');

    // Check uniqueness if product name changed
    if (newProduct !== existing.product) {
      const dup = all.find((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === brandId && String(x?.product || '').trim() === newProduct && String(x?.id || '') !== id);
      if (dup) return { ok: false, status: 400, error: 'duplicate_product', message: `产品「${newProduct}」已存在` };
    }

    // Compute grossPerUnit from cost + avg price
    const historyRows = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [];
    const priceMap = ctx.computeAvgPricePerProduct(historyRows, storeScope.length ? storeScope : [store], aliasLookup);
    const avgPrice = priceMap.get(ctx.resolveForecastProductName(newProduct, aliasLookup).key) || 0;
    let gpu = existing.grossPerUnit || 0;
    if (Number.isFinite(newCost) && newCost >= 0) {
      gpu = avgPrice > newCost ? Number((avgPrice - newCost).toFixed(4)) : 0;
    }

    all[idx] = {
      ...existing,
      brandId,
      brandName,
      product: newProduct,
      bizType: newBizType,
      costPerUnit: Number.isFinite(newCost) ? newCost : existing.costPerUnit,
      grossPerUnit: Number.isFinite(gpu) ? Number(gpu.toFixed(4)) : 0,
      updatedAt: now,
      updatedBy: username
    };

    await ctx.saveSharedState({ ...state0, forecastGrossProfitProfiles: all });
    return { ok: true, item: all[idx] };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function deleteGrossProfitProfile(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可删除产品毛利' };

  const id = String(input.params?.id || '').trim();
  if (!id) return { ok: false, status: 400, error: 'missing_id' };

  try {
    const state0 = (await ctx.getSharedState()) || {};
    let all = Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles.slice() : [];
    const before = all.length;
    all = all.filter((x) => String(x?.id || '').trim() !== id);
    if (all.length === before) return { ok: false, status: 404, error: 'not_found' };
    await ctx.saveSharedState({ ...state0, forecastGrossProfitProfiles: all });
    return { ok: true};
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

export async function estimateGrossMargin(ctx, input) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

  const date = ctx.safeDateOnly(input.body?.date);
  const startDate = ctx.safeDateOnly(input.body?.startDate || date);
  const endDate = ctx.safeDateOnly(input.body?.endDate || date || input.body?.startDate);
  const bizType = ctx.normalizeForecastBizType(input.body?.bizType);
  if (!startDate || !endDate) return { ok: false, status: 400, error: 'missing_date_range' };

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const scope = ctx.resolveForecastScope(state0, username, role, input.body?.store, input.body?.brandId);
    if (!scope.brandId || !scope.storeScope.length) return { ok: false, status: 400, error: 'missing_brand_or_store_scope' };

    const historyRows = await loadGrossProfitHistory(ctx, state0, scope, {
      bizType,
      startDate,
      endDate,
    });
    let profiles = (Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles : [])
      .filter((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === scope.brandId)
      .slice(0, 5000);
    profiles = await mergeDishLibraryCosts(ctx, profiles, scope, { log });
    const aliasLookup = ctx.buildForecastProductAliasLookup(state0, { store: scope.store, brandId: scope.brandId });

    const estimate = ctx.estimateGrossMarginByHistory({
      historyRows,
      profiles,
      startDate,
      endDate,
      bizType,
      storeScope: scope.storeScope,
      aliasLookup
    });
    return { ok: true,
      store: scope.store || '',
      brandId: scope.brandId,
      brandName: scope.brandName,
      bizType: bizType || '',
      startDate,
      endDate,
      estimate
    };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
