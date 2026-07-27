/**
 * Inventory forecast revenue estimation + accuracy evaluation lookup. Returns { ok, status?, error?, ...payload }.
 */

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
