export function createHistoryFromPosHelpers({
  pool,
  resolveTenantIdDefault,
  normalizeStoreKey,
  safeDateOnly,
  safeNumber,
  normalizeForecastBizType,
  normalizeForecastSlot,
  isKnownPublicHoliday,
  isCNYPeriod,
  sortForecastHistoryRows,
}) {
  // POS 上传门店名（导出全称，如「洪潮传统潮汕菜【大宁久光中心店】」）与系统配置门店名
  // （简称，如「洪潮大宁久光店」）属于两套命名体系，直接等值匹配取不到数（毛利率/预测全为0）。
  // 这里把配置门店名解析成真实 POS 门店名：① 精确 key 命中；② 用品牌词（店名前2个汉字）圈定
  // POS 候选，品牌下唯一候选即命中；③ 多候选时用去掉品牌/通用词后的位置词最长公共子串≥2 兜底。
  // 解析不到则回退原 key（结果与修复前一致，不引入回归）。结果带 60s 缓存。
  const _posStoreListCache = new Map();

  async function listPosStoreNames() {
    const now = Date.now();
    const tenantId = resolveTenantIdDefault();
    const cached = _posStoreListCache.get(tenantId);
    if (cached && now - cached.at < 60000 && cached.list.length) return cached.list;
    try {
      const r = await pool.query(`SELECT DISTINCT store FROM pos_sales_detail WHERE store IS NOT NULL AND trim(store) <> ''`);
      const list = (r.rows || []).map((x) => String(x.store || '').trim()).filter(Boolean);
      _posStoreListCache.set(tenantId, { at: now, list });
      return list;
    } catch (_e) { /* keep stale cache on error */ }
    return cached?.list || [];
  }

  function longestCommonRun(a, b) {
    if (!a || !b) return 0;
    let best = 0;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        let k = 0;
        while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
        if (k > best) best = k;
      }
    }
    return best;
  }

  function stripStoreGenericWords(key) {
    return String(key || '').replace(/(传统潮汕菜|广东小馆|荔枝木烧鹅|上海|北京|深圳|广州|中心|门店|店铺|商场|购物中心|店)/g, '');
  }

  async function resolvePosStoreKeys(storeScope) {
    const wanted = (Array.isArray(storeScope) ? storeScope : []).map((x) => String(x || '').trim()).filter(Boolean);
    if (!wanted.length) return [];
    const posStores = await listPosStoreNames();
    if (!posStores.length) return Array.from(new Set(wanted.map((x) => normalizeStoreKey(x)).filter(Boolean)));
    const out = new Set();
    for (const w of wanted) {
      const wk = normalizeStoreKey(w);
      const exact = posStores.find((p) => normalizeStoreKey(p) === wk);
      if (exact) { out.add(normalizeStoreKey(exact)); continue; }
      const brandTok = (w.match(/[一-龥]{2}/) || [''])[0]; // 店名前2个汉字作品牌词
      let cands = brandTok ? posStores.filter((p) => p.includes(brandTok)) : posStores.slice();
      if (cands.length !== 1) {
        const wa = stripStoreGenericWords(wk);
        const scored = cands
          .map((c) => ({ c, run: longestCommonRun(wa, stripStoreGenericWords(normalizeStoreKey(c))) }))
          .filter((x) => x.run >= 2)
          .sort((a, b) => b.run - a.run);
        cands = scored.length ? [scored[0].c] : [];
      }
      out.add(cands.length === 1 ? normalizeStoreKey(cands[0]) : wk);
    }
    return Array.from(out);
  }

  async function loadInventoryForecastHistoryFromSalesRaw({ storeScope, bizType, slot, startDate, endDate }) {
    const stores = Array.isArray(storeScope)
      ? Array.from(new Set(storeScope.map((x) => String(x || '').trim()).filter(Boolean)))
      : [];
    if (!stores.length) return [];
    const storeKeys = await resolvePosStoreKeys(stores);
    if (!storeKeys.length) return [];

    const qBizType = normalizeForecastBizType(bizType);
    const qSlot = normalizeForecastSlot(slot);
    const start = safeDateOnly(startDate);
    const end = safeDateOnly(endDate);
    const where = [`lower(regexp_replace(COALESCE(store,''),'\\s+','','g')) = ANY($1)`];
    const params = [storeKeys];
    if (start) {
      params.push(start);
      where.push(`date >= $${params.length}::date`);
    }
    if (end) {
      params.push(end);
      where.push(`date <= $${params.length}::date`);
    }
    if (qBizType) {
      params.push(qBizType);
      where.push(`(
      ($${params.length} = 'takeaway' AND lower(regexp_replace(COALESCE(biz_type,''),'\\s+','','g')) IN ('takeaway','delivery','外卖','外送'))
      OR
      ($${params.length} = 'dinein' AND lower(regexp_replace(COALESCE(biz_type,''),'\\s+','','g')) IN ('dinein','堂食','店内','堂食点餐'))
    )`);
    }

    const sql = `
    SELECT
      store,
      date::text AS date,
      biz_type,
      COALESCE(slot, '') AS slot,
      dish_name,
      ROUND(SUM(COALESCE(qty, 0))::numeric, 2) AS qty,
      ROUND(SUM(COALESCE(sales_amount, 0))::numeric, 2) AS sales_amount,
      ROUND(SUM(COALESCE(revenue, 0))::numeric, 2) AS revenue,
      ROUND(SUM(COALESCE(discount, 0))::numeric, 2) AS discount
    FROM pos_sales_detail
    WHERE ${where.join(' AND ')}
    GROUP BY store, date, biz_type, slot, dish_name
    ORDER BY date DESC
  `;

    const resp = await pool.query(sql, params);
    const grouped = new Map();
    for (const raw of (resp.rows || [])) {
      const date = safeDateOnly(raw?.date);
      const biz = normalizeForecastBizType(raw?.biz_type);
      const slotName = normalizeForecastSlot(raw?.slot);
      const product = String(raw?.dish_name || '').trim();
      const qty = safeNumber(raw?.qty);
      const salesAmount = safeNumber(raw?.sales_amount);
      const revenue = safeNumber(raw?.revenue);
      const discount = safeNumber(raw?.discount);
      if (!date || !biz || !slotName || !product || !Number.isFinite(qty) || qty <= 0) continue;
      if (qBizType && biz !== qBizType) continue;
      if (qSlot && slotName !== qSlot) continue;

      const key = `${String(raw?.store || '').trim()}||${biz}||${slotName}||${date}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: `pos_sales:${key}`,
          store: String(raw?.store || '').trim(),
          bizType: biz,
          slot: slotName,
          date,
          weather: '',
          isHoliday: !!(isKnownPublicHoliday(date) || isCNYPeriod(date)),
          expectedRevenue: 0,
          actualRevenue: 0,
          totalDiscount: 0,
          productQuantities: {},
          source: 'pos_sales_detail',
          createdAt: `${date}T00:00:00.000Z`,
          updatedAt: `${date}T23:59:59.000Z`
        });
      }
      const row = grouped.get(key);
      const expectedRevenueInc = Number.isFinite(salesAmount) && salesAmount > 0
        ? salesAmount
        : Math.max(0, Number(revenue || 0) + Number(discount || 0));
      row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + expectedRevenueInc).toFixed(2));
      row.actualRevenue = Number((Number(row.actualRevenue || 0) + (Number.isFinite(revenue) ? revenue : 0)).toFixed(2));
      row.totalDiscount = Number((Number(row.totalDiscount || 0) + (Number.isFinite(discount) ? discount : 0)).toFixed(2));
      row.productQuantities[product] = Number((Number(row.productQuantities[product] || 0) + qty).toFixed(2));
    }
    return sortForecastHistoryRows(Array.from(grouped.values()));
  }

  return {
    resolvePosStoreKeys,
    loadInventoryForecastHistoryFromSalesRaw,
    longestCommonRun,
    stripStoreGenericWords,
  };
}
