export function createParseInventoryForecastRowsFromTableMatrix({
  normalizeForecastUploadDate,
  normalizeForecastBizType,
  normalizeForecastStoreName,
  normalizeForecastWeather,
  normalizeForecastSlotFromHourRange,
  isExcludedForecastProduct,
}) {
  function parseInventoryForecastRowsFromTableMatrix(matrix, fallbackBizType = '', options = {}) {
    const rows = Array.isArray(matrix) ? matrix : [];
    if (!rows.length) return [];
    const fallbackDate = normalizeForecastUploadDate(options?.fallbackDate || '');
    const allowTodayFallbackDate = options?.allowTodayFallbackDate !== false;
    const norm = (x) => String(x || '').trim();
    const normHead = (x) => norm(x).toLowerCase().replace(/\s+/g, '');
    const cleanHead = (x) => normHead(x).replace(/[\/:：()（）\[\]【】_\-~～]/g, '');
    const rowMetaValue = (line, keyReg) => {
      const arr = Array.isArray(line) ? line.map(norm) : [];
      for (let i = 0; i < arr.length; i += 1) {
        const cell = String(arr[i] || '');
        const compact = cell.replace(/\s+/g, '');
        if (!keyReg.test(cell) && !keyReg.test(compact)) continue;
        for (let j = i + 1; j < arr.length; j += 1) {
          if (arr[j]) return arr[j];
        }
      }
      return '';
    };

    let headerRowIndex = -1;
    for (let i = 0; i < rows.length; i += 1) {
      const line = Array.isArray(rows[i]) ? rows[i] : [];
      const heads = line.map((x) => cleanHead(x));
      const _joined = heads.join('|');
      const hasSlot = heads.some((h) => /餐时段名称|时段名称|餐时段|时段/.test(h));
      const hasProduct = heads.some((h) => /菜品名称|商品名称|产品名称|产品|菜品|品名/.test(h));
      const hasQty = heads.some((h) => /销售数量|数量|qty|quantity/.test(h));
      const hasAmount = heads.some((h) => /销售金额|销售额|销售收入|折前营收|折前营业额|折前收入|金额/.test(h));
      const hasSeqNo = heads.some((h) => /^序号$/.test(h));
      const hasDate = heads.some((h) => /营业日期|销售日期|日期/.test(h));
      const hasActualRevenue = heads.some((h) => /实际收入|实收|实际营收|菜品收入|家品收入|折后营收|折后收入/.test(h));
      const hasOrderTime = heads.some((h) => /下单时间|点单时间|订单时间/.test(h));
      const _hasCheckoutTime = heads.some((h) => /结账时间|结算时间/.test(h));
      const _hasDiscount = heads.some((h) => /优惠金额|优惠|折扣/.test(h));
      const _hasMenuPrice = heads.some((h) => /菜谱售价|售价|单价|菜品售价/.test(h));
      // Accept if we have slot+product+qty, or slot+product+amount, or seqNo+slot+product
      if ((hasSlot && hasProduct && hasQty) || (hasSlot && hasProduct && hasAmount) || (hasSeqNo && hasSlot && hasProduct)) {
        headerRowIndex = i;
        break;
      }
      // New format: 序号+营业日期+菜品名称+销售数量 (no slot column, derive from 下单时间/结账时间)
      if (hasSeqNo && hasDate && hasProduct && hasQty) {
        headerRowIndex = i;
        break;
      }
      // New format variant: 营业日期+菜品名称+销售数量+实际收入
      if (hasDate && hasProduct && hasQty && hasActualRevenue) {
        headerRowIndex = i;
        break;
      }
      // Fuzzy: if row has >=3 known header keywords, accept it
      const knownCount = [hasSlot, hasProduct, hasQty, hasAmount, hasSeqNo, hasDate, hasActualRevenue, hasOrderTime].filter(Boolean).length;
      if (knownCount >= 3) {
        headerRowIndex = i;
        break;
      }
    }
    const dataStartIndex = headerRowIndex >= 0 ? (headerRowIndex + 1) : 0;

    let defaultDate = fallbackDate || '';
    let defaultBizType = normalizeForecastBizType(fallbackBizType);
    let defaultStore = '';
    let defaultWeather = '';
    for (let i = 0; i < (headerRowIndex >= 0 ? headerRowIndex : Math.min(rows.length, 12)); i += 1) {
      const line = Array.isArray(rows[i]) ? rows[i] : [];
      if (!defaultDate) {
        const v = rowMetaValue(line, /营业日期|销售日期|日期/);
        if (v) defaultDate = normalizeForecastUploadDate(v);
      }
      if (!defaultBizType) {
        const v = rowMetaValue(line, /销售类型|类型/);
        if (v) defaultBizType = normalizeForecastBizType(v);
      }
      if (!defaultStore) {
        const v = rowMetaValue(line, /门店|店铺|商户|销售门店|门店名称/);
        if (v) defaultStore = normalizeForecastStoreName(v);
      }
      if (!defaultWeather) {
        const v = rowMetaValue(line, /天气|weather/i);
        if (v) defaultWeather = normalizeForecastWeather(v);
      }
    }
    if (!defaultDate && allowTodayFallbackDate) {
      defaultDate = normalizeForecastUploadDate(new Date().toISOString());
    }

    const headersRaw = headerRowIndex >= 0 && Array.isArray(rows[headerRowIndex]) ? rows[headerRowIndex] : [];
    const headers = headersRaw.map(cleanHead);
    const idx = (names) => {
      for (const n of names) {
        const i = headers.indexOf(cleanHead(n));
        if (i >= 0) return i;
      }
      return -1;
    };

    const iDate = idx(['销售日期', '日期', 'date', '营业日期']);
    const iBizType = idx(['销售类型', '类型', 'biztype']);
    const iSlot = idx(['餐/时段名称', '时段名称', '餐时段', '时段']);
    const iProduct = idx(['菜品名称', '商品名称', '品名', '产品', 'product']);
    const iQty = idx(['销售数量', '数量', 'qty', 'quantity']);
    const iAmount = idx(['销售金额', '销售额', '销售收入', '折前营收', '折前营业额', '折前收入', 'amount']);
    const iStore = idx(['门店', '店铺', '商户', '销售门店', '门店名称', 'store']);
    const iWeather = idx(['天气', 'weather']);
    // New format columns
    const iActualRevenue = idx(['实际收入', '实收', '实际营收', '实收金额', '实收营业额', '实收金额元', '菜品收入', '家品收入', '折后营收', '折后收入']);
    const iDiscount = idx(['优惠金额', '优惠', '折扣']);
    const _iMenuPrice = idx(['菜谱售价', '售价', '单价', '菜品售价']);
    const iOrderTime = idx(['下单时间', '点单时间', '订单时间']);
    const iCheckoutTime = idx(['结账时间', '结算时间']);
    const _iDept = idx(['出品部门', '部门']);
    const _iCategory = idx(['大类名称/编码', '大类名称', '大类', '类别']);

    const grouped = new Map();
    const parseNumCell = (v) => {
      const s = String(v == null ? '' : v).replace(/[,，\s]/g, '').replace(/[¥￥]/g, '').trim();
      if (!s) return NaN;
      const n = Number(s);
      return Number.isFinite(n) ? n : NaN;
    };
    const looksLikeTimeRange = (v) => {
      const s = String(v || '').trim();
      if (!s) return false;
      // Standard: 17:00~18:00 or 17：00～18：00
      if (/\d{1,2}\s*[:：]\s*\d{1,2}\s*[~～\-—–至到]\s*\d{1,2}\s*[:：]\s*\d{1,2}/.test(s)) return true;
      // AM/PM: 5:00 PM - 6:00 PM
      if (/\d{1,2}\s*[:：]\s*\d{1,2}.*(?:AM|PM|am|pm|上午|下午)/.test(s)) return true;
      // Decimal time from Excel: 0.4166666 to 0.9166666
      const dec = Number(s);
      if (Number.isFinite(dec) && dec > 0 && dec < 1) return true;
      // Single time: 17:00 or 17：00
      if (/^\d{1,2}\s*[:：]\s*\d{1,2}(?:\s*[:：]\s*\d{1,2})?$/.test(s)) return true;
      return false;
    };
    for (let r = dataStartIndex; r < rows.length; r += 1) {
      const line = Array.isArray(rows[r]) ? rows[r] : [];
      if (!line.length) continue;
      const product = norm(iProduct >= 0 ? line[iProduct] : '');
      const qty = parseNumCell(iQty >= 0 ? line[iQty] : 0);
      if (!product || isExcludedForecastProduct(product) || !Number.isFinite(qty) || qty <= 0) continue;

      const dateRaw = norm(iDate >= 0 ? line[iDate] : '');
      const date = normalizeForecastUploadDate(dateRaw) || defaultDate;
      if (!date) continue;

      const bizRaw = norm(iBizType >= 0 ? line[iBizType] : '');
      const bizType = normalizeForecastBizType(bizRaw) || defaultBizType || 'dinein';
      const store = normalizeForecastStoreName(iStore >= 0 ? line[iStore] : '') || defaultStore;

      // Derive slot: prefer explicit slot column, then 下单时间, then 结账时间
      let slotRaw = norm(iSlot >= 0 ? line[iSlot] : '');
      let slot = slotRaw ? normalizeForecastSlotFromHourRange(slotRaw, store) : '';
      if (!slot && iOrderTime >= 0) {
        slot = normalizeForecastSlotFromHourRange(norm(line[iOrderTime]), store);
      }
      if (!slot && iCheckoutTime >= 0) {
        slot = normalizeForecastSlotFromHourRange(norm(line[iCheckoutTime]), store);
      }
      // If still no slot and we have a datetime in the date column, try extracting time from it
      if (!slot && dateRaw && /\d{1,2}[:：]\d{1,2}/.test(dateRaw)) {
        slot = normalizeForecastSlotFromHourRange(dateRaw, store);
      }
      if (!slot) continue;
      const weather = normalizeForecastWeather(iWeather >= 0 ? line[iWeather] : '') || defaultWeather;

      // 约定：销售收入 = 折前营收（expectedRevenue）
      const amount = parseNumCell(iAmount >= 0 ? line[iAmount] : 0);
      const expectedRevenueInc = Number.isFinite(amount) && amount > 0 ? amount : 0;
      // 约定：菜品收入 = 折后营收（actualRevenue），用于实收毛利率计算
      const actualRevenueRaw = parseNumCell(iActualRevenue >= 0 ? line[iActualRevenue] : 0);
      const discountRaw = parseNumCell(iDiscount >= 0 ? line[iDiscount] : 0);
      const discountInc = Number.isFinite(discountRaw) ? Math.abs(discountRaw) : 0;
      const derivedActualRevenue = Math.max(0, expectedRevenueInc - discountInc);
      const actualRevenueInc = Number.isFinite(actualRevenueRaw) && actualRevenueRaw > 0
        ? actualRevenueRaw
        : derivedActualRevenue;

      const key = `${bizType}||${slot}||${date}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          store,
          bizType,
          slot,
          date,
          weather: weather || '',
          isHoliday: false,
          expectedRevenue: 0,
          actualRevenue: 0,
          totalDiscount: 0,
          productQuantities: {}
        });
      }
      const row = grouped.get(key);
      if (!row.store && store) row.store = store;
      if (!row.weather && weather) row.weather = weather;
      row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + expectedRevenueInc).toFixed(2));
      row.actualRevenue = Number((Number(row.actualRevenue || 0) + actualRevenueInc).toFixed(2));
      row.totalDiscount = Number((Number(row.totalDiscount || 0) + discountInc).toFixed(2));
      row.productQuantities[product] = Number((Number(row.productQuantities[product] || 0) + qty).toFixed(2));
    }

    // Fallback: for complex/merged templates from Excel export, infer columns by row shape.
    if (!grouped.size) {
      for (let r = dataStartIndex; r < rows.length; r += 1) {
        const line = Array.isArray(rows[r]) ? rows[r].map(norm) : [];
        if (!line.length) continue;
        let slotIdx = -1;
        for (let i = 0; i < line.length; i += 1) {
          if (looksLikeTimeRange(line[i])) {
            slotIdx = i;
            break;
          }
        }
        if (slotIdx < 0) continue;
        const slot = normalizeForecastSlotFromHourRange(line[slotIdx], defaultStore);
        if (!slot) continue;

        const numericCells = [];
        for (let i = 0; i < line.length; i += 1) {
          const n = parseNumCell(line[i]);
          if (Number.isFinite(n)) numericCells.push({ i, n });
        }
        if (!numericCells.length) continue;

        const amountCell = numericCells[numericCells.length - 1];
        const qtyCell = numericCells
          .filter((x) => x.i < amountCell.i)
          .sort((a, b) => b.i - a.i)[0] || null;
        const qty = qtyCell ? qtyCell.n : NaN;
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const amount = Number.isFinite(amountCell?.n) ? amountCell.n : 0;

        let product = '';
        for (let i = (qtyCell ? qtyCell.i : amountCell.i) - 1; i >= 0; i -= 1) {
          const cell = line[i];
          if (!cell) continue;
          if (looksLikeTimeRange(cell)) continue;
          if (Number.isFinite(parseNumCell(cell))) continue;
          if (cell === '-' || cell === '—' || cell === '–' || cell === '一') continue;
          if (/(^序号$|^菜品大类$|^菜品中类$|^餐时段名称$|^时段名称$|^销售数量$|^销售金额$)/.test(cell.replace(/\s+/g, ''))) continue;
          product = cell;
          break;
        }
        if (!product) continue;

        let date = '';
        for (let i = 0; i < line.length; i += 1) {
          date = normalizeForecastUploadDate(line[i]);
          if (date) break;
        }
        date = date || defaultDate;
        if (!date) continue;

        let bizType = '';
        for (let i = 0; i < line.length; i += 1) {
          bizType = normalizeForecastBizType(line[i]);
          if (bizType) break;
        }
        bizType = bizType || defaultBizType || 'dinein';

        let weather = '';
        for (let i = 0; i < line.length; i += 1) {
          const s = normalizeForecastWeather(line[i]);
          if (!s) continue;
          if (/(晴|阴|雨|雪|风|雾|多云|weather)/i.test(s)) {
            weather = s;
            break;
          }
        }
        weather = weather || defaultWeather;

        let store = '';
        for (let i = 0; i < line.length; i += 1) {
          const s = normalizeForecastStoreName(line[i]);
          if (!s) continue;
          if (/(门店|店铺|广场店|久光店|万象城|商场|mall|store)/i.test(s)) {
            store = s;
            break;
          }
        }
        store = store || defaultStore;

        const key = `${bizType}||${slot}||${date}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            store,
            bizType,
            slot,
            date,
            weather: weather || '',
            isHoliday: false,
            expectedRevenue: 0,
            productQuantities: {}
          });
        }
        const row = grouped.get(key);
        if (!row.store && store) row.store = store;
        if (!row.weather && weather) row.weather = weather;
        row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + (amount > 0 ? amount : 0)).toFixed(2));
        row.productQuantities[product] = Number((Number(row.productQuantities[product] || 0) + qty).toFixed(2));
      }
    }
    return Array.from(grouped.values()).filter((x) => x.bizType && x.slot && x.date && Object.keys(x.productQuantities || {}).length);
  }
  return parseInventoryForecastRowsFromTableMatrix;
}
