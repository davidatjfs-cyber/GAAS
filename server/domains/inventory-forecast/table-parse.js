function tableParseNorm(x) {
  return String(x || '').trim();
}

function tableParseNormHead(x) {
  return tableParseNorm(x).toLowerCase().replace(/\s+/g, '');
}

function tableParseCleanHead(x) {
  return tableParseNormHead(x).replace(/[\/:：()（）\[\]【】_\-~～]/g, '');
}

function tableParseRowMetaValue(line, keyReg) {
  const arr = Array.isArray(line) ? line.map(tableParseNorm) : [];
  for (let i = 0; i < arr.length; i += 1) {
    const cell = String(arr[i] || '');
    const compact = cell.replace(/\s+/g, '');
    if (!keyReg.test(cell) && !keyReg.test(compact)) continue;
    for (let j = i + 1; j < arr.length; j += 1) {
      if (arr[j]) return arr[j];
    }
  }
  return '';
}

function tableParseNumCell(v) {
  const s = String(v == null ? '' : v).replace(/[,，\s]/g, '').replace(/[¥￥]/g, '').trim();
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function tableParseLooksLikeTimeRange(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  if (/\d{1,2}\s*[:：]\s*\d{1,2}\s*[~～\-—–至到]\s*\d{1,2}\s*[:：]\s*\d{1,2}/.test(s)) return true;
  if (/\d{1,2}\s*[:：]\s*\d{1,2}.*(?:AM|PM|am|pm|上午|下午)/.test(s)) return true;
  const dec = Number(s);
  if (Number.isFinite(dec) && dec > 0 && dec < 1) return true;
  if (/^\d{1,2}\s*[:：]\s*\d{1,2}(?:\s*[:：]\s*\d{1,2})?$/.test(s)) return true;
  return false;
}

export function findInventoryForecastTableHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const line = Array.isArray(rows[i]) ? rows[i] : [];
    const heads = line.map((x) => tableParseCleanHead(x));
    const hasSlot = heads.some((h) => /餐时段名称|时段名称|餐时段|时段/.test(h));
    const hasProduct = heads.some((h) => /菜品名称|商品名称|产品名称|产品|菜品|品名/.test(h));
    const hasQty = heads.some((h) => /销售数量|数量|qty|quantity/.test(h));
    const hasAmount = heads.some((h) => /销售金额|销售额|销售收入|折前营收|折前营业额|折前收入|金额/.test(h));
    const hasSeqNo = heads.some((h) => /^序号$/.test(h));
    const hasDate = heads.some((h) => /营业日期|销售日期|日期/.test(h));
    const hasActualRevenue = heads.some((h) => /实际收入|实收|实际营收|菜品收入|家品收入|折后营收|折后收入/.test(h));
    const hasOrderTime = heads.some((h) => /下单时间|点单时间|订单时间/.test(h));
    if ((hasSlot && hasProduct && hasQty) || (hasSlot && hasProduct && hasAmount) || (hasSeqNo && hasSlot && hasProduct)) {
      return i;
    }
    if (hasSeqNo && hasDate && hasProduct && hasQty) {
      return i;
    }
    if (hasDate && hasProduct && hasQty && hasActualRevenue) {
      return i;
    }
    const knownCount = [hasSlot, hasProduct, hasQty, hasAmount, hasSeqNo, hasDate, hasActualRevenue, hasOrderTime].filter(Boolean).length;
    if (knownCount >= 3) {
      return i;
    }
  }
  return -1;
}

export function extractInventoryForecastTableDefaults(deps, rows, headerRowIndex, fallbackDate, fallbackBizType, allowTodayFallbackDate) {
  let defaultDate = fallbackDate || '';
  let defaultBizType = deps.normalizeForecastBizType(fallbackBizType);
  let defaultStore = '';
  let defaultWeather = '';
  for (let i = 0; i < (headerRowIndex >= 0 ? headerRowIndex : Math.min(rows.length, 12)); i += 1) {
    const line = Array.isArray(rows[i]) ? rows[i] : [];
    if (!defaultDate) {
      const v = tableParseRowMetaValue(line, /营业日期|销售日期|日期/);
      if (v) defaultDate = deps.normalizeForecastUploadDate(v);
    }
    if (!defaultBizType) {
      const v = tableParseRowMetaValue(line, /销售类型|类型/);
      if (v) defaultBizType = deps.normalizeForecastBizType(v);
    }
    if (!defaultStore) {
      const v = tableParseRowMetaValue(line, /门店|店铺|商户|销售门店|门店名称/);
      if (v) defaultStore = deps.normalizeForecastStoreName(v);
    }
    if (!defaultWeather) {
      const v = tableParseRowMetaValue(line, /天气|weather/i);
      if (v) defaultWeather = deps.normalizeForecastWeather(v);
    }
  }
  if (!defaultDate && allowTodayFallbackDate) {
    defaultDate = deps.normalizeForecastUploadDate(new Date().toISOString());
  }
  return { defaultDate, defaultBizType, defaultStore, defaultWeather };
}

export function buildInventoryForecastTableColumnIndexes(headersRaw) {
  const headers = headersRaw.map(tableParseCleanHead);
  const idx = (names) => {
    for (const n of names) {
      const i = headers.indexOf(tableParseCleanHead(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    iDate: idx(['销售日期', '日期', 'date', '营业日期']),
    iBizType: idx(['销售类型', '类型', 'biztype']),
    iSlot: idx(['餐/时段名称', '时段名称', '餐时段', '时段']),
    iProduct: idx(['菜品名称', '商品名称', '品名', '产品', 'product']),
    iQty: idx(['销售数量', '数量', 'qty', 'quantity']),
    iAmount: idx(['销售金额', '销售额', '销售收入', '折前营收', '折前营业额', '折前收入', 'amount']),
    iStore: idx(['门店', '店铺', '商户', '销售门店', '门店名称', 'store']),
    iWeather: idx(['天气', 'weather']),
    iActualRevenue: idx(['实际收入', '实收', '实际营收', '实收金额', '实收营业额', '实收金额元', '菜品收入', '家品收入', '折后营收', '折后收入']),
    iDiscount: idx(['优惠金额', '优惠', '折扣']),
    iOrderTime: idx(['下单时间', '点单时间', '订单时间']),
    iCheckoutTime: idx(['结账时间', '结算时间']),
  };
}

export function parseInventoryForecastPrimaryTableRows(deps, rows, dataStartIndex, grouped, colIdx, defaults) {
  const { defaultDate, defaultBizType, defaultStore, defaultWeather } = defaults;
  const {
    iDate, iBizType, iSlot, iProduct, iQty, iAmount, iStore, iWeather,
    iActualRevenue, iDiscount, iOrderTime, iCheckoutTime,
  } = colIdx;

  for (let r = dataStartIndex; r < rows.length; r += 1) {
    const line = Array.isArray(rows[r]) ? rows[r] : [];
    if (!line.length) continue;
    const product = tableParseNorm(iProduct >= 0 ? line[iProduct] : '');
    const qty = tableParseNumCell(iQty >= 0 ? line[iQty] : 0);
    if (!product || deps.isExcludedForecastProduct(product) || !Number.isFinite(qty) || qty <= 0) continue;

    const dateRaw = tableParseNorm(iDate >= 0 ? line[iDate] : '');
    const date = deps.normalizeForecastUploadDate(dateRaw) || defaultDate;
    if (!date) continue;

    const bizRaw = tableParseNorm(iBizType >= 0 ? line[iBizType] : '');
    const bizType = deps.normalizeForecastBizType(bizRaw) || defaultBizType || 'dinein';
    const store = deps.normalizeForecastStoreName(iStore >= 0 ? line[iStore] : '') || defaultStore;

    let slotRaw = tableParseNorm(iSlot >= 0 ? line[iSlot] : '');
    let slot = slotRaw ? deps.normalizeForecastSlotFromHourRange(slotRaw, store) : '';
    if (!slot && iOrderTime >= 0) {
      slot = deps.normalizeForecastSlotFromHourRange(tableParseNorm(line[iOrderTime]), store);
    }
    if (!slot && iCheckoutTime >= 0) {
      slot = deps.normalizeForecastSlotFromHourRange(tableParseNorm(line[iCheckoutTime]), store);
    }
    if (!slot && dateRaw && /\d{1,2}[:：]\d{1,2}/.test(dateRaw)) {
      slot = deps.normalizeForecastSlotFromHourRange(dateRaw, store);
    }
    if (!slot) continue;
    const weather = deps.normalizeForecastWeather(iWeather >= 0 ? line[iWeather] : '') || defaultWeather;

    const amount = tableParseNumCell(iAmount >= 0 ? line[iAmount] : 0);
    const expectedRevenueInc = Number.isFinite(amount) && amount > 0 ? amount : 0;
    const actualRevenueRaw = tableParseNumCell(iActualRevenue >= 0 ? line[iActualRevenue] : 0);
    const discountRaw = tableParseNumCell(iDiscount >= 0 ? line[iDiscount] : 0);
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
}

export function parseInventoryForecastFallbackTableRows(deps, rows, dataStartIndex, grouped, defaults) {
  const { defaultDate, defaultBizType, defaultStore, defaultWeather } = defaults;

  for (let r = dataStartIndex; r < rows.length; r += 1) {
    const line = Array.isArray(rows[r]) ? rows[r].map(tableParseNorm) : [];
    if (!line.length) continue;
    let slotIdx = -1;
    for (let i = 0; i < line.length; i += 1) {
      if (tableParseLooksLikeTimeRange(line[i])) {
        slotIdx = i;
        break;
      }
    }
    if (slotIdx < 0) continue;
    const slot = deps.normalizeForecastSlotFromHourRange(line[slotIdx], defaultStore);
    if (!slot) continue;

    const numericCells = [];
    for (let i = 0; i < line.length; i += 1) {
      const n = tableParseNumCell(line[i]);
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
      if (tableParseLooksLikeTimeRange(cell)) continue;
      if (Number.isFinite(tableParseNumCell(cell))) continue;
      if (cell === '-' || cell === '—' || cell === '–' || cell === '一') continue;
      if (/(^序号$|^菜品大类$|^菜品中类$|^餐时段名称$|^时段名称$|^销售数量$|^销售金额$)/.test(cell.replace(/\s+/g, ''))) continue;
      product = cell;
      break;
    }
    if (!product) continue;

    let date = '';
    for (let i = 0; i < line.length; i += 1) {
      date = deps.normalizeForecastUploadDate(line[i]);
      if (date) break;
    }
    date = date || defaultDate;
    if (!date) continue;

    let bizType = '';
    for (let i = 0; i < line.length; i += 1) {
      bizType = deps.normalizeForecastBizType(line[i]);
      if (bizType) break;
    }
    bizType = bizType || defaultBizType || 'dinein';

    let weather = '';
    for (let i = 0; i < line.length; i += 1) {
      const s = deps.normalizeForecastWeather(line[i]);
      if (!s) continue;
      if (/(晴|阴|雨|雪|风|雾|多云|weather)/i.test(s)) {
        weather = s;
        break;
      }
    }
    weather = weather || defaultWeather;

    let store = '';
    for (let i = 0; i < line.length; i += 1) {
      const s = deps.normalizeForecastStoreName(line[i]);
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

export function parseInventoryForecastRowsFromTableMatrix(deps, matrix, fallbackBizType = '', options = {}) {
  const rows = Array.isArray(matrix) ? matrix : [];
  if (!rows.length) return [];
  const fallbackDate = deps.normalizeForecastUploadDate(options?.fallbackDate || '');
  const allowTodayFallbackDate = options?.allowTodayFallbackDate !== false;

  const headerRowIndex = findInventoryForecastTableHeaderRowIndex(rows);
  const dataStartIndex = headerRowIndex >= 0 ? (headerRowIndex + 1) : 0;
  const defaults = extractInventoryForecastTableDefaults(
    deps,
    rows,
    headerRowIndex,
    fallbackDate,
    fallbackBizType,
    allowTodayFallbackDate
  );

  const headersRaw = headerRowIndex >= 0 && Array.isArray(rows[headerRowIndex]) ? rows[headerRowIndex] : [];
  const colIdx = buildInventoryForecastTableColumnIndexes(headersRaw);

  const grouped = new Map();
  parseInventoryForecastPrimaryTableRows(deps, rows, dataStartIndex, grouped, colIdx, defaults);

  if (!grouped.size) {
    parseInventoryForecastFallbackTableRows(deps, rows, dataStartIndex, grouped, defaults);
  }
  return Array.from(grouped.values()).filter((x) => x.bizType && x.slot && x.date && Object.keys(x.productQuantities || {}).length);
}

export function createParseInventoryForecastRowsFromTableMatrix(deps) {
  return (matrix, fallbackBizType = '', options = {}) =>
    parseInventoryForecastRowsFromTableMatrix(deps, matrix, fallbackBizType, options);
}
