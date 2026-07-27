/**
 * Inventory forecast core-product sales tracking + product analytics. Returns { ok, status?, error?, ...payload }.
 */

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
