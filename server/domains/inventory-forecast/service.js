/**
 * Inventory forecast + sales-raw dish-alias — pure business logic (no req/res).
 * Returns { ok, status?, error?, message?, ...payload }.
 */
import { childLogger } from '../../utils/logger.js';
import {
  parsePredictForecastInput,
  loadPredictForecastHistory,
  buildPredictForecastOutput,
  persistPredictForecastState,
} from './predict-forecast-helpers.js';
import {
  loadGrossProfitHistory,
  mergeDishLibraryCosts,
} from './gross-profit-helpers.js';
import { runUploadHistoryFile } from './upload-history-file-helpers.js';
export {
  listDishAliases,
  createDishAlias,
  updateDishAlias,
  deleteDishAlias,
} from './dish-alias-service.js';
export {
  listProductAliases,
  createProductAlias,
  updateProductAlias,
  deleteProductAlias,
} from './product-alias-service.js';
export {
  listCoreProducts,
  createCoreProduct,
  deleteCoreProduct,
} from './core-product-service.js';

const log = childLogger({ domain: 'inventory-forecast', handler: 'service' });

export async function listHistory(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const bizType = ctx.normalizeForecastBizType(input.query?.bizType);
    const slot = ctx.normalizeForecastSlot(input.query?.slot);
    const start = ctx.safeDateOnly(input.query?.start);
    const end = ctx.safeDateOnly(input.query?.end);
    const qStore = String(input.query?.store || '').trim();
    const limit = Math.max(1, Math.min(1000, Number(input.query?.limit || 300) || 300));

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const today = new Date().toISOString().slice(0, 10);
      const salesRawItems = await ctx.loadInventoryForecastHistoryFromSalesRaw({
        storeScope: [store],
        bizType,
        slot,
        startDate: start || ctx.shiftForecastDate(end || today, -180),
        endDate: end || today
      });
      const items = salesRawItems.slice(0, limit);
      return { ok: true,
        store,
        bizType: bizType || '',
        slot: slot || '',
        storageSource: salesRawItems.length ? 'pos_sales_detail' : 'inventoryForecastHistory',
        items
      };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function clearHistory(ctx, input) {

    const role = String(input.role || '').trim();
    if (role !== 'admin') return { ok: false, status: 403, error: 'admin_only' };
    try {
      const state0 = (await ctx.getSharedState()) || {};
      const qStore = String(input.query?.store || input.body?.store || '').trim();
      const prevCount = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory.length : 0;
      if (qStore) {
        state0.inventoryForecastHistory = (state0.inventoryForecastHistory || []).filter((x) => String(x?.store || '').trim() !== qStore);
        state0.inventoryForecastPredictions = (state0.inventoryForecastPredictions || []).filter((x) => String(x?.store || '').trim() !== qStore);
        state0.inventoryForecastEvaluations = (state0.inventoryForecastEvaluations || []).filter((x) => String(x?.store || '').trim() !== qStore);
      } else {
        state0.inventoryForecastHistory = [];
        state0.inventoryForecastPredictions = [];
        state0.inventoryForecastEvaluations = [];
      }
      await ctx.saveSharedState(state0);
      const afterCount = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory.length : 0;
      // 严禁在此删除 sales_raw：无 store 参数时曾误执行 DELETE FROM sales_raw 全表，导致生产数据被清空。
      return { ok: true, cleared: prevCount - afterCount, remaining: afterCount, store: qStore || '(all)' };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function batchHistory(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const bizType = ctx.normalizeForecastBizType(input.body?.bizType);
    const slot = ctx.normalizeForecastSlot(input.body?.slot);
    if (!bizType) return { ok: false, status: 400, error: 'invalid_biz_type' };
    if (!slot) return { ok: false, status: 400, error: 'invalid_slot' };
    const rowsRaw = Array.isArray(input.body?.rows) ? input.body.rows : [];
    if (!rowsRaw.length) return { ok: false, status: 400, error: 'missing_rows' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const storeBody = String(input.body?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : storeBody;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };
      const ret = ctx.upsertInventoryForecastHistoryInState(state0, { store, bizType, slot, rowsRaw, username });
      await ctx.saveSharedState(ret.state);

      return {
        ok: true,
        store,
        bizType,
        slot,
        inserted: ret.inserted,
        updated: ret.updated,
        skipped: ret.skipped,
        accepted: ret.accepted,
        evaluated: ret.evaluated
      };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function uploadHistoryFile(ctx, input) {
  return runUploadHistoryFile(ctx, input, { log, uploadsDir: ctx.uploadsDir });
}

export async function uploadHistoryImage(_ctx, _input) {

    return { ok: false, status: 410,
      error: 'image_upload_disabled',
      message: '图片上传功能已下线，请使用 Excel 或 PDF 上传历史数据。'
    };
  
}

export async function uploadSalesRaw(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };
    // sales_raw表已于2026-07-03下线，手工上传销售明细的流程被pos_order_items自动同步取代，
    // 不再需要人工上传。（文件清理由 routes finally 负责）
    return { ok: false, status: 410,
      error: 'sales_raw_retired',
      message: '销售明细已改为自动同步（pos_order_items/pos_sales_detail），不再需要手工上传销售明细文件。'
    };
}

export async function getCoreProductSales(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const startDate = ctx.safeDateOnly(input.query?.startDate || input.query?.start);
    const endDate = ctx.safeDateOnly(input.query?.endDate || input.query?.end);
    if (!startDate || !endDate) return { ok: false, status: 400, error: 'missing_date_range' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.query?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      // Get core products for this store
      const coreProducts = (Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts : [])
        .filter(x => String(x?.store || '').trim() === store);
      if (!coreProducts.length) return { ok: true, store, startDate, endDate, items: [], message: '暂无核心产品配置' };

      const aliasLookup = ctx.buildForecastProductAliasLookup(state0, store);

      // Build normalized name → core product mapping
      const coreMap = new Map();
      coreProducts.forEach(cp => {
        const resolved = ctx.resolveForecastProductName(cp.product, aliasLookup);
        if (resolved.key) coreMap.set(resolved.key, cp);
      });

      // Aggregate actual sales from history within date range
      const historyRows = (Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [])
        .filter(x => String(x?.store || '').trim() === store)
        .filter(x => ctx.inDateRange(String(x?.date || '').trim(), startDate, endDate));

      // Count unique dates in range for daily target calculation
      const uniqueDates = new Set();
      historyRows.forEach(x => { const d = ctx.safeDateOnly(x?.date); if (d) uniqueDates.add(d); });
      const dayCount = uniqueDates.size || 1;

      // Aggregate quantities by normalized product name
      const salesAgg = new Map();
      historyRows.forEach(row => {
        const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
        Object.entries(products).forEach(([product, qtyRaw]) => {
          const qty = Number(qtyRaw || 0);
          if (qty <= 0) return;
          const resolved = ctx.resolveForecastProductName(product, aliasLookup);
          if (!resolved.key) return;
          // Only count if it matches a core product
          if (!coreMap.has(resolved.key)) return;
          salesAgg.set(resolved.key, (salesAgg.get(resolved.key) || 0) + qty);
        });
      });

      // Build result items
      const items = coreProducts.map(cp => {
        const resolved = ctx.resolveForecastProductName(cp.product, aliasLookup);
        const actualQty = salesAgg.get(resolved.key) || 0;
        const dailyTarget = Number(cp.targetQty || 0);
        const totalTarget = dailyTarget * dayCount;
        const achievementRate = totalTarget > 0 ? Number((actualQty / totalTarget).toFixed(4)) : 0;
        return {
          id: cp.id,
          product: cp.product,
          normalizedName: resolved.key,
          dailyTarget,
          totalTarget: Number(totalTarget.toFixed(1)),
          actualQty: Number(actualQty.toFixed(1)),
          achievementRate,
          achievementPct: Number((achievementRate * 100).toFixed(1)),
          dayCount
        };
      });

      items.sort((a, b) => b.achievementRate - a.achievementRate);
      return { ok: true, store, startDate, endDate, dayCount, items };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function getAnalytics(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.query?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const bizType = ctx.normalizeForecastBizType(input.query?.bizType);
      const startDate = ctx.safeDateOnly(input.query?.startDate);
      const endDate = ctx.safeDateOnly(input.query?.endDate);

      let filtered = [];
      if (startDate && endDate) {
        const salesRawRows = await ctx.loadInventoryForecastHistoryFromSalesRaw({
          storeScope: [store],
          bizType,
          startDate,
          endDate
        });
        filtered = salesRawRows.filter(x => String(x?.store || '').trim() === store);
      }
      if (bizType) filtered = filtered.filter(x => String(x?.bizType || '').trim() === bizType);
      if (startDate) filtered = filtered.filter(x => String(x?.date || '').trim() >= startDate);
      if (endDate) filtered = filtered.filter(x => String(x?.date || '').trim() <= endDate);

      const aliasLookup = ctx.buildForecastProductAliasLookup(state0, store);
      const productStats = new Map();
      filtered.forEach(row => {
        const pqs = row?.productQuantities || {};
        const rev = Number(row?.expectedRevenue || 0);
        const totalQtyOfRow = Object.entries(pqs)
          .filter(([name]) => !ctx.isExcludedForecastProduct(name))
          .reduce((a, [, q]) => a + Number(q || 0), 0);
        Object.entries(pqs).forEach(([product, qty]) => {
          if (ctx.isExcludedForecastProduct(product)) return;
          const resolved = ctx.resolveForecastProductName(product, aliasLookup);
          if (!resolved.key) return;
          if (!productStats.has(resolved.key)) {
            productStats.set(resolved.key, { product: resolved.display, totalQty: 0, totalRevenue: 0, occurrences: 0 });
          }
          const st = productStats.get(resolved.key);
          st.totalQty += Number(qty || 0);
          st.totalRevenue += rev > 0 && totalQtyOfRow > 0 ? (Number(qty || 0) / totalQtyOfRow) * rev : 0;
          st.occurrences += 1;
        });
      });

      const stats = Array.from(productStats.values()).map(s => ({
        product: s.product,
        totalQty: Number(s.totalQty.toFixed(1)),
        totalRevenue: Number(s.totalRevenue.toFixed(2)),
        avgQty: Number((s.totalQty / s.occurrences).toFixed(1)),
        occurrences: s.occurrences
      }));

      const top20ByQty = stats.slice().sort((a, b) => b.totalQty - a.totalQty).slice(0, 20);
      const top20ByRevenue = stats.slice().sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 20);
      const bottom10ByRevenue = stats.filter(s => s.totalRevenue > 0).sort((a, b) => a.totalRevenue - b.totalRevenue).slice(0, 10);
      const coreTargets = (Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts : [])
        .filter((x) => String(x?.store || '').trim() === store)
        .filter((x) => !ctx.isExcludedForecastProduct(x?.product));
      const statByProduct = new Map(stats.map((x) => [ctx.normalizeProductName(x.product), x]));
      const coreTargetStats = coreTargets.map((t) => {
        const product = String(t?.product || '').trim();
        const targetQty = Number(t?.targetQty || 0);
        const actualQty = Number(statByProduct.get(ctx.normalizeProductName(product))?.totalQty || 0);
        const completionRate = targetQty > 0 ? Math.max(0, Number((actualQty / targetQty).toFixed(4))) : 0;
        return {
          product,
          targetQty: Number(targetQty.toFixed(1)),
          actualQty: Number(actualQty.toFixed(1)),
          gapQty: Number((targetQty - actualQty).toFixed(1)),
          completionRate: Number((completionRate * 100).toFixed(1))
        };
      }).sort((a, b) => b.completionRate - a.completionRate);

      return { ok: true,
        store,
        bizType: bizType || 'all',
        startDate: startDate || '',
        endDate: endDate || '',
        sampleCount: filtered.length,
        top20ByQty,
        top20ByRevenue,
        bottom10ByRevenue,
        coreTargetStats
      };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function estimateRevenue(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const date = ctx.safeDateOnly(input.body?.date);
    const weather = ctx.normalizeForecastWeather(input.body?.weather);
    const isHoliday = !!(input.body?.isHoliday === true || input.body?.isHoliday === 1 || input.body?.isHoliday === '1' || String(input.body?.isHoliday || '').trim().toLowerCase() === 'true' || String(input.body?.isHoliday || '').trim() === '是');
    if (!date) return { ok: false, status: 400, error: 'missing_date' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.body?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const all = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [];
      const historyRows = all
        .filter((x) => String(x?.store || '').trim() === store)
        .filter((x) => {
          const d = String(x?.date || '').trim();
          return !d || d <= date;
        })
        .slice(0, 1200);

      // 补充 POS订单明细 数据提高预测准确度（扩至90天以覆盖1月正常数据）
      // 配置门店名→真实 POS 门店名解析，避免命名体系不一致导致补充数据为空。
      const nsk = (await ctx.resolvePosStoreKeys([store]))[0] || String(store||'').trim().toLowerCase().replace(/\s+/g,'');
      const targetDow0 = (() => { try { const td=new Date(date+'T00:00:00'); return Number.isFinite(td.getTime())?td.getDay():-1; } catch(e){return -1;} })();
      const targetIsNormalWd0 = targetDow0>=1 && targetDow0<=5 && !isHoliday && !ctx.isCNYPeriod(date) && !ctx.isKnownPublicHoliday(date);
      // For normal-weekday targets: strip CNY/holiday records from stored history
      // so sales_raw normal-January data can fill in those dates instead.
      if (targetIsNormalWd0) {
        for (let i = historyRows.length - 1; i >= 0; i--) {
          const d = ctx.safeDateOnly(historyRows[i]?.date);
          if (d && (ctx.isCNYPeriod(d) || ctx.isKnownPublicHoliday(d))) { historyRows.splice(i, 1); }
        }
      }
      try {
        // 按堂食/外卖分别补充近90天日营收，口径与上方一致用折前(sales_amount)，避免把外卖营收误记到堂食、或混用折后口径。
        const srR = await ctx.pool.query(`SELECT s.date::text AS date, s.biz_type, ROUND(SUM(COALESCE(s.sales_amount,0))::numeric,2) AS day_revenue FROM pos_sales_detail s WHERE lower(regexp_replace(coalesce(s.store,''),'\\s+','','g'))=$1 AND s.date<=$2::date AND s.date>=($2::date-INTERVAL '90 days') GROUP BY s.date, s.biz_type ORDER BY s.date DESC`,[nsk,date]);
        const exD=new Set(historyRows.map(r=>`${safeDateOnly(r?.date)}||${normalizeForecastBizType(r?.bizType)}`));
        for(const sr of(srR.rows||[])){
          const d=ctx.safeDateOnly(sr.date),biz=ctx.normalizeForecastBizType(sr.biz_type),rev=Number(sr.day_revenue)||0;
          if(!d||!biz||rev<=0||exD.has(`${d}||${biz}`))continue;
          const srIsCNY=ctx.isCNYPeriod(d),srIsHol=ctx.isKnownPublicHoliday(d);
          // For normal-weekday targets: skip CNY and public-holiday source days entirely
          if(targetIsNormalWd0 && (srIsCNY||srIsHol)) continue;
          historyRows.push({date:d,bizType:biz,slot:'',expectedRevenue:rev,isHoliday:srIsCNY||srIsHol});
        }
      } catch(e){ /* ignore */ }

      const target = { date, weather, isHoliday };
      const estimate = ctx.estimateRevenueByHistory(historyRows, target, store);
      return { ok: true, store, target, estimate };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

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

      const keyOf = (x) => `${normalizeBrandId(x?.brandId || resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId)}||${String(x?.product || '').trim()}`;
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
          id: prev?.id || randomUUID(),
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

export async function getAccuracy(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const qStore = String(input.query?.store || '').trim();
    const bizType = ctx.normalizeForecastBizType(input.query?.bizType);
    const slot = ctx.normalizeForecastSlot(input.query?.slot);
    const start = ctx.safeDateOnly(input.query?.start);
    const end = ctx.safeDateOnly(input.query?.end);
    const limit = Math.max(1, Math.min(1200, Number(input.query?.limit || 300) || 300));

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      let items = Array.isArray(state0.inventoryForecastEvaluations) ? state0.inventoryForecastEvaluations.slice() : [];
      items = items.filter((x) => String(x?.store || '').trim() === store);
      if (bizType) items = items.filter((x) => String(x?.bizType || '').trim() === bizType);
      if (slot) items = items.filter((x) => String(x?.slot || '').trim() === slot);
      if (start || end) {
        items = items.filter((x) => ctx.inDateRange(String(x?.date || '').trim(), start, end));
      }
      items.sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')) || String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
      items = items.slice(0, limit);
      const summary = ctx.summarizeForecastAccuracyRows(items);
      return { ok: true, store, bizType: bizType || '', slot: slot || '', summary, items };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function predictForecast(ctx, input) {
  const parsed = parsePredictForecastInput(input, ctx);
  if (!parsed.ok) return parsed;

  const {
    username,
    role,
    bizType,
    slot,
    date,
    weather,
    isHoliday,
    expectedRevenue,
    topN,
    qStore,
  } = parsed;

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const myStore = ctx.pickMyStoreFromState(state0, username);
    const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
    if (!store) return { ok: false, status: 400, error: 'missing_store' };

    const aliasLookup = ctx.buildForecastProductAliasLookup(state0, store);
    const { historyRows, slotSplit, slotExpectedRevenue } = await loadPredictForecastHistory(ctx, {
      store,
      bizType,
      slot,
      date,
      aliasLookup,
      expectedRevenue,
    });

    const target = {
      store,
      bizType,
      slot,
      date,
      weather,
      isHoliday,
      expectedRevenue: slotExpectedRevenue,
    };

    const built = await buildPredictForecastOutput(ctx, {
      state0,
      historyRows,
      target,
      topN,
      date,
      store,
      bizType,
      slot,
      expectedRevenue,
      username,
    });

    await persistPredictForecastState(ctx, state0, built.predictionBundle);

    return {
      ok: true,
      store,
      bizType,
      slot,
      target,
      slotSplit: {
        inputRevenue: Number(expectedRevenue.toFixed(2)),
        slotShare: slotSplit.slotShare,
        slotRevenue: slotExpectedRevenue,
        splitMode: slotSplit.splitMode,
      },
      historyCount: historyRows.length,
      source: built.source,
      confidence: Number(built.out?.confidence || 0),
      summary: built.summary,
      predictions: built.calibratedPredictions,
      calibration: built.calibration,
      immediateAccuracy: built.predictionBundle.immediateEval ? {
        totalAccuracy: built.predictionBundle.immediateEval.totalAccuracy,
        mape: built.predictionBundle.immediateEval.mape,
        hitRate20: built.predictionBundle.immediateEval.hitRate20,
      } : null,
      coreTargetUsage: built.coreTargetUsage,
      generatedAt: built.predictionBundle.now,
    };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
