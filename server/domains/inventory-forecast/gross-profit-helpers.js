/**
 * Shared gross-profit profile history and dish-cost helpers.
 */
export async function mergeDishLibraryCosts(ctx, profiles, scope, {
  includeSource = false,
  log,
} = {}) {
  try {
    const storeKeys = scope.storeScope.map((store) => ctx.normalizeStoreKey(store));
    const brand = ctx.forecastBrandToken(`${scope.brandName || ''}${scope.storeScope.join('')}`);
    const params = [storeKeys];
    let brandClause = '';
    if (brand) {
      params.push(brand);
      brandClause = ` AND (brand=$${params.length} OR brand='*')`;
    }
    const result = await ctx.pool.query(
      `SELECT biz_type,dish_name,unit_cost FROM dish_library_costs WHERE enabled=TRUE AND (lower(regexp_replace(coalesce(store,''),'\\s+','','g'))=ANY($1) OR store='*')${brandClause}`,
      params
    );
    const keys = new Set(profiles.map((profile) => (
      `${ctx.normalizeForecastBizType(profile?.bizType) || ''}||${ctx.normalizeProductName(String(profile?.product || '').trim())}`
    )));
    const merged = profiles.slice();
    for (const row of result.rows || []) {
      const bizType = ctx.normalizeForecastBizType(row.biz_type) || '';
      const product = String(row.dish_name || '').trim();
      const normalizedProduct = ctx.normalizeProductName(product);
      const costPerUnit = ctx.safeNumber(row.unit_cost);
      if (!normalizedProduct || !Number.isFinite(costPerUnit) || costPerUnit < 0) continue;

      const key = `${bizType}||${normalizedProduct}`;
      if (keys.has(key)) continue;
      merged.push({
        product,
        bizType,
        costPerUnit: Number(costPerUnit.toFixed(4)),
        ...(includeSource ? { source: 'feishu_bitable' } : {}),
      });
      keys.add(key);
    }
    return merged;
  } catch (error) {
    log?.error({
      msg: 'inventory_gross_profit_dish_costs_merge_failed',
      err: error?.message || String(error),
    });
    return profiles;
  }
}

export async function loadGrossProfitHistory(ctx, state, scope, {
  bizType = '',
  startDate,
  endDate,
  filterStateByRange = true,
} = {}) {
  const salesRows = await ctx.loadInventoryForecastHistoryFromSalesRaw({
    storeScope: scope.storeScope,
    bizType,
    startDate,
    endDate,
  });
  const stateRows = (Array.isArray(state.inventoryForecastHistory) ? state.inventoryForecastHistory : [])
    .filter((row) => scope.storeScope.includes(String(row?.store || '').trim()))
    .filter((row) => !bizType || String(row?.bizType || '').trim() === bizType)
    .filter((row) => !filterStateByRange || ctx.inDateRange(String(row?.date || '').trim(), startDate, endDate))
    .slice(0, 5000);
  return ctx.mergePreferredForecastHistoryRows(salesRows, stateRows, 5000);
}
