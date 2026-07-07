import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import XLSX from 'xlsx';
import { STORES, storeIdToName, storeNameToId, inferBrandFromStoreName } from './brands-config.js';
import {
  buildCustomerAssetMetricsInput,
  buildOperationImprovementMetricsInput,
  buildTalentDevelopmentMetricsInput,
  enrichReportForBusinessOntology,
} from './ontology/report-metrics-adapters.js';
import { reviewOntologyTaskHistory } from './ontology/ontology-task-adapter.js';

const PYTHON_BIN = process.env.CUSTOMER_OPS_PYTHON_BIN || process.env.CODEX_PYTHON_BIN || 'python3';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 40).replace(/[^0-9]/g, '').slice(-11);
}

function num(value) {
  if (value == null || value === '') return 0;
  const n = Number(String(value).replace(/[¥,，\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function uniqueClean(values, max = 160) {
  return Array.from(new Set((values || []).map((v) => cleanText(v, max)).filter(Boolean)));
}

function sqlLikePattern(value) {
  const s = cleanText(value, 160).replace(/[\\%_]/g, '\\$&');
  return s ? `%${s}%` : '';
}

function storeKeywordsFromName(value) {
  const s = cleanText(value, 160);
  const words = [];
  if (!s) return words;
  for (const store of STORES) {
    if (s.includes(store.name) || s.includes(store.brandName) || store.name.includes(s) || store.brandName.includes(s)) {
      words.push(store.name, store.brandName, store.storeId);
    }
  }
  const brand = inferBrandFromStoreName(s);
  if (brand) words.push(brand);
  if (s.includes('洪潮')) words.push('洪潮', '64822111', '洪潮大宁久光店');
  if (s.includes('马己仙')) words.push('马己仙', '51866138', '马己仙上海音乐广场店');
  return words;
}

async function resolveCustomerOpsStoreFilter(pool, tenantId, rawStoreId = '') {
  const raw = cleanText(rawStoreId || '', 120);
  if (!raw) {
    return { requested: '', displayName: '全部门店', posStoreIds: [], posStoreNames: [], posStorePatterns: [] };
  }

  let stateStores = [];
  try {
    const r = await pool.query(`SELECT data->'stores' AS stores FROM hrms_state WHERE key = $1 LIMIT 1`, [tenantId || 'default']);
    stateStores = Array.isArray(r.rows?.[0]?.stores) ? r.rows[0].stores : [];
  } catch (e) {
    console.warn('[customer-ops] store state lookup skipped:', e?.message);
  }

  const stateStore = stateStores.find((s) => cleanText(s?.id, 120) === raw || cleanText(s?.name, 160) === raw || cleanText(s?.brandName || s?.brand, 160) === raw);
  const configuredId = storeNameToId(raw);
  const configuredName = configuredId ? storeIdToName(configuredId) : '';
  const displayName = cleanText(stateStore?.name || configuredName || storeIdToName(raw) || raw, 160);
  const candidates = uniqueClean([
    raw,
    stateStore?.id,
    stateStore?.name,
    stateStore?.brandName,
    stateStore?.brand,
    configuredId,
    configuredName,
    ...storeKeywordsFromName(raw),
    ...storeKeywordsFromName(stateStore?.name),
    ...storeKeywordsFromName(stateStore?.brandName || stateStore?.brand),
  ]);
  const patterns = uniqueClean(candidates.map(sqlLikePattern));

  let posRows = [];
  try {
    const r = await pool.query(`
      SELECT DISTINCT store_id, store_name
      FROM pos_orders
      WHERE store_id = ANY($1::text[])
         OR store_name = ANY($1::text[])
         OR store_name ILIKE ANY($2::text[])
      LIMIT 20`, [candidates, patterns]);
    posRows = r.rows || [];
  } catch (e) {
    console.warn('[customer-ops] POS store lookup skipped:', e?.message);
  }

  const posStoreIds = uniqueClean([...posRows.map((r) => r.store_id), configuredId, raw]);
  const posStoreNames = uniqueClean([...posRows.map((r) => r.store_name), stateStore?.name, configuredName]);
  const posStorePatterns = uniqueClean([...posStoreNames, ...candidates].map(sqlLikePattern));
  return {
    requested: raw,
    displayName: stateStore?.name || configuredName || posRows[0]?.store_name || displayName,
    posStoreIds,
    posStoreNames,
    posStorePatterns,
  };
}

function posStoreFilterSql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `($3::text = '' OR ${p}store_id = ANY($4::text[]) OR ${p}store_name = ANY($5::text[]) OR ${p}store_name ILIKE ANY($6::text[]))`;
}

function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const s = cleanText(value, 80);
  const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function hourOf(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getHours();
  if (typeof value === 'number') {
    if (!(value > 0 && value < 1) && value < 20000) return null;
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && Number.isFinite(parsed.H)) return parsed.H;
  }
  const s = cleanText(value, 80);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!(n > 0 && n < 1)) return null;
  }
  const hm = s.match(/(?:\s|T|^)(\d{1,2}):(\d{2})/);
  if (hm) return Math.max(0, Math.min(23, Number(hm[1])));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

const FIELD_DEFS = {
  orderNo: { label: '订单号', aliases: ['订单号', '订单编号', '订单id', '流水号', '单号', '账单号', '小票号', '小票编号', '消费流水号', 'order no', 'order_no', 'orderid', 'bill no', 'receipt no'] },
  memberNo: { label: '会员号', aliases: ['会员号', '会员编号', '会员卡号', '卡号', '客户编号', 'customer id', 'member id', 'member_no', 'card no'] },
  phone: { label: '手机号', aliases: ['会员手机号', '手机号', '手机', '联系电话', '顾客电话', '客人电话', '电话', 'mobile', 'phone', 'tel'] },
  dish: { label: '菜品/商品', aliases: ['商品名称', '菜品名称', '菜名', '品名', '商品', '项目名称', '消费项目', 'dish_name', 'item name', 'product name', 'menu item'] },
  store: { label: '门店', aliases: ['门店名称', '门店', '店铺名称', '分店', '营业点', 'store_name', 'store', 'shop'] },
  bizDate: { label: '营业日期', aliases: ['营业日', '营业日期', '日期', '消费日期', '结账日期', '下单日期', 'biz_date', 'business date', 'date'] },
  checkoutRaw: { label: '结账/下单时间', aliases: ['结账时间', '支付时间', '下单时间', '开台时间', '消费时间', 'checkout_time', 'order_time', 'time'] },
  amount: { label: '实收金额', aliases: ['折后金额', '实收金额', '净收', '净收入', '实收', '应收金额', '消费金额', '订单金额', '销售金额', '支付金额', '结算金额', '小计', '金额', 'amount_after_discount', 'revenue', 'amount', 'paid amount'] },
  rechargeAmount: { label: '储值/充值金额', aliases: ['充值金额', '储值金额', '充值本金', '充值实收', '储值实收', '本金', '入账金额', '增加金额', 'recharge', 'topup', 'stored value'] },
  giftAmount: { label: '赠送金额', aliases: ['赠送金额', '赠送', '赠金', '赠送余额', 'gift amount', 'bonus'] },
  balance: { label: '储值余额', aliases: ['余额', '储值余额', '卡余额', '账户余额', '会员余额', 'balance'] },
  points: { label: '积分', aliases: ['积分', '本次积分', '剩余积分', 'points'] },
  diners: { label: '就餐人数', aliases: ['就餐人数', '人数', '客数', '用餐人数', 'diners', 'guest count', 'pax'] },
  orderType: { label: '订单类型', aliases: ['订单类型', '堂食外卖', '订单来源', '就餐方式', '消费类型', '业务类型', '交易类型', '类型', 'order_type', 'source'] },
  memberName: { label: '会员姓名', aliases: ['会员姓名', '顾客姓名', '客户姓名', '客人姓名', '姓名', 'member_name', 'customer_name', 'name'] },
  tableNo: { label: '桌台', aliases: ['桌台', '桌号', '台号', '房间', '包房', 'table_no', 'table'] },
  qty: { label: '数量', aliases: ['数量', '销量', '份数', 'qty', 'quantity'] },
  category: { label: '品类', aliases: ['商品大类', '商品中类', '品类', '类别', '分类', 'category'] }
};

function canonicalHeader(v) {
  return cleanText(v, 120).replace(/\s+/g, '').replace(/[()（）【】\[\]_-]/g, '').toLowerCase();
}

function valueScore(field, value) {
  const raw = cleanText(value, 160);
  if (!raw) return 0;
  if (field === 'phone') return cleanPhone(raw).length === 11 ? 4 : 0;
  if (field === 'bizDate') return dateOnly(value) ? 3 : 0;
  if (field === 'checkoutRaw') return hourOf(value) != null ? 2 : 0;
  if (field === 'amount') { const n = num(value); return n > 0 && n < 1000000 ? 3 : 0; }
  if (field === 'diners' || field === 'qty') { const n = num(value); return n > 0 && n < 200 && String(raw).length <= 8 ? 2 : 0; }
  if (field === 'dish') return /[菜饭面汤酒虾蟹鱼肉牛鸡鸭鹅豆茶奶咖啡包点]|[a-z]{3,}/i.test(raw) && raw.length <= 80 ? 1.5 : 0;
  if (field === 'orderNo') return /[a-z0-9-]{5,}/i.test(raw) && raw.length <= 80 ? 1 : 0;
  return raw ? 0.5 : 0;
}

function headerScore(field, header) {
  const h = canonicalHeader(header);
  if (!h) return 0;
  const def = FIELD_DEFS[field] || {};
  for (const alias of def.aliases || []) {
    const a = canonicalHeader(alias);
    if (h === a) return 10;
    if (h.includes(a) || a.includes(h)) return 7;
  }
  return 0;
}

function inferMapping(headers, sampleRows) {
  const used = new Set();
  const mapping = {};
  const fieldScores = {};
  for (const field of Object.keys(FIELD_DEFS)) {
    const candidates = headers.map((h, col) => {
      const values = sampleRows.slice(0, 80).map((r) => r[col]);
      const populated = values.filter((v) => cleanText(v, 160)).length;
      const pattern = values.reduce((s, v) => s + valueScore(field, v), 0);
      const score = headerScore(field, h) + (populated ? pattern / Math.max(1, populated) : 0);
      return { col, header: cleanText(h || `列${col + 1}`, 120), score, populated };
    }).sort((a, b) => b.score - a.score);
    fieldScores[field] = candidates.slice(0, 3);
  }
  for (const field of ['phone', 'bizDate', 'checkoutRaw', 'balance', 'rechargeAmount', 'giftAmount', 'points', 'amount', 'orderNo', 'memberNo', 'dish', 'store', 'diners', 'orderType', 'memberName', 'tableNo', 'qty', 'category']) {
    const cand = (fieldScores[field] || []).find((x) => x.score >= (['phone', 'amount', 'bizDate'].includes(field) ? 2.5 : 1.2) && !used.has(x.col));
    if (cand) { mapping[field] = cand; used.add(cand.col); }
  }
  return { mapping, fieldScores };
}

function worksheetTables(workbook) {
  const tables = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
    if (!matrix.length) continue;
    let best = { rowIndex: 0, score: -1 };
    const maxHeaderScan = Math.min(12, matrix.length);
    for (let i = 0; i < maxHeaderScan; i++) {
      const row = matrix[i] || [];
      const nonEmpty = row.filter((v) => cleanText(v, 80)).length;
      const score = row.reduce((s, v) => s + Math.max(...Object.keys(FIELD_DEFS).map((f) => headerScore(f, v))), 0) + nonEmpty * 0.15;
      if (score > best.score) best = { rowIndex: i, score };
    }
    const headers = (matrix[best.rowIndex] || []).map((h, i) => cleanText(h || `列${i + 1}`, 120));
    const dataRows = matrix.slice(best.rowIndex + 1).filter((r) => (r || []).some((v) => cleanText(v, 80)));
    const inferred = inferMapping(headers, dataRows);
    tables.push({ sheetName, headerRow: best.rowIndex + 1, headers, dataRows, ...inferred });
  }
  return tables;
}

function cell(row, mapping, field) {
  const col = mapping?.[field]?.col;
  return Number.isInteger(col) ? row[col] : '';
}

function inferSheetKind(mapping, sheetName = '') {
  const hay = canonicalHeader(`${sheetName} ${Object.values(mapping || {}).map((m) => m.header).join(' ')}`);
  if (mapping?.rechargeAmount || mapping?.balance || /储值|充值|余额|topup|storedvalue/.test(hay)) return 'stored_value';
  if (mapping?.dish || mapping?.diners || /菜品|商品|pos|小票|订单明细|消费流水/.test(hay)) return 'pos_consumption';
  if (mapping?.amount || /会员消费|消费明细|交易明细/.test(hay)) return 'member_consumption';
  if (mapping?.phone || mapping?.memberNo) return 'member_profile';
  return 'unknown';
}

function recordKeyOf(record) {
  const parts = [
    record.kind || 'record',
    record.orderNo || record.memberNo || record.phone || 'unknown',
    record.bizDate || '',
    record.amount || 0,
    record.rechargeAmount || 0,
    (record.items || []).map((x) => x.dish).join('|'),
    record.sourceSheet || ''
  ];
  return parts.join(':').replace(/\s+/g, '');
}

function classifyCustomer(c, nowTs) {
  const visits = c.orders.length;
  const daysSince = c.lastDate ? Math.floor((nowTs - new Date(`${c.lastDate}T00:00:00Z`).getTime()) / 86400000) : 999;
  const avg = c.totalSpend / Math.max(visits, 1);
  const tags = [];
  let lifecycle = 'occasional';
  if (visits <= 1) lifecycle = 'one_time';
  else if (visits >= 8 || (visits >= 4 && daysSince <= 30)) lifecycle = 'regular';
  else if (daysSince > 45) lifecycle = 'at_risk';
  if (daysSince > 90) lifecycle = 'dormant';
  if (avg >= 800 || c.totalSpend >= 10000) tags.push('high_value');
  if (c.businessSignals >= 2 || avg >= 800) tags.push('business');
  if (c.familySignals >= 2) tags.push('family');
  if (daysSince >= Math.max(30, c.avgInterval * 1.8)) tags.push('risk');
  return { lifecycle, tags, daysSince };
}

function normalizeWorkbook(filePath, opts = {}) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const orders = new Map();
  const itemsByOrder = new Map();
  const diagnostics = { source_file: opts.sourceFile || path.basename(filePath), sheets: [], missing_required: [], warnings: [], confidence_score: 0, record_types: {} };
  for (const table of worksheetTables(workbook)) {
    const { sheetName, headerRow, mapping, dataRows } = table;
    const sheetKind = inferSheetKind(mapping, sheetName);
    const present = Object.fromEntries(Object.keys(FIELD_DEFS).map((f) => [f, !!mapping[f]]));
    diagnostics.sheets.push({ sheet_name: sheetName, inferred_type: sheetKind, header_row: headerRow, rows: dataRows.length, mapping: Object.fromEntries(Object.entries(mapping).map(([field, m]) => [field, { label: FIELD_DEFS[field]?.label || field, source_header: m.header, confidence: Math.min(100, Math.round(m.score * 9)) }])), present });
    for (const row of dataRows) {
      const orderNo = cleanText(cell(row, mapping, 'orderNo'), 120);
      const memberNo = cleanText(cell(row, mapping, 'memberNo'), 120);
      const phone = cleanPhone(cell(row, mapping, 'phone'));
      const dish = cleanText(cell(row, mapping, 'dish'), 160);
      const store = cleanText(cell(row, mapping, 'store'), 160);
      const bizDate = dateOnly(cell(row, mapping, 'bizDate') || cell(row, mapping, 'checkoutRaw'));
      const checkoutRaw = cell(row, mapping, 'checkoutRaw') || cell(row, mapping, 'bizDate');
      const amountRaw = num(cell(row, mapping, 'amount'));
      const rechargeRaw = num(cell(row, mapping, 'rechargeAmount'));
      const giftAmount = num(cell(row, mapping, 'giftAmount'));
      const balance = num(cell(row, mapping, 'balance'));
      const points = num(cell(row, mapping, 'points'));
      const diners = num(cell(row, mapping, 'diners'));
      const orderType = cleanText(cell(row, mapping, 'orderType'), 80);
      const memberName = cleanText(cell(row, mapping, 'memberName'), 80);
      const tableNo = cleanText(cell(row, mapping, 'tableNo'), 80);
      const qty = num(cell(row, mapping, 'qty'));
      const rowKind = rechargeRaw || balance || /储值|充值|余额|充卡/.test(orderType) ? 'stored_value' : sheetKind;
      const amount = rowKind === 'stored_value' ? 0 : amountRaw;
      const rechargeAmount = rowKind === 'stored_value' ? (rechargeRaw || amountRaw) : rechargeRaw;
      if (dish && (orderNo || phone || bizDate)) {
        const itemKey = orderNo || `${phone || 'unknown'}:${bizDate}:${amount || rechargeAmount}`;
        const list = itemsByOrder.get(itemKey) || [];
        list.push({ dish, qty: qty || 1, amount, category: cleanText(cell(row, mapping, 'category'), 80) });
        itemsByOrder.set(itemKey, list);
      }
      const hasOrderSignal = !!(phone || bizDate || store || memberName || diners || orderType || tableNo);
      if (!orderNo && !memberNo && !phone && !amount && !rechargeAmount && !balance && !bizDate) continue;
      if (!hasOrderSignal && dish) continue;
      const key = orderNo || `${rowKind}:${phone || memberNo || 'unknown'}:${bizDate}:${amount || rechargeAmount || balance}:${orders.size}`;
      const prev = orders.get(key) || {};
      const record = { orderNo: key, memberNo: memberNo || prev.memberNo || '', kind: rowKind || 'unknown', sourceFile: opts.sourceFile || path.basename(filePath), sourceSheet: sheetName, phone: phone || prev.phone || '', memberName: memberName || prev.memberName || '', store: store || prev.store || '', bizDate: bizDate || prev.bizDate || '', hour: hourOf(checkoutRaw) ?? prev.hour ?? null, amount: amount || prev.amount || 0, rechargeAmount: rechargeAmount || prev.rechargeAmount || 0, giftAmount: giftAmount || prev.giftAmount || 0, balance: balance || prev.balance || 0, points: points || prev.points || 0, diners: diners || prev.diners || 0, orderType: orderType || prev.orderType || '', tableNo: tableNo || prev.tableNo || '' };
      record.recordKey = recordKeyOf(record);
      orders.set(key, record);
    }
  }
  for (const [orderNo, items] of itemsByOrder.entries()) { const order = orders.get(orderNo); if (order) order.items = items; }
  const normalized = Array.from(orders.values()).filter((o) => o.bizDate || o.amount || o.rechargeAmount || o.balance || o.phone || o.memberNo);
  for (const r of normalized) diagnostics.record_types[r.kind || 'unknown'] = (diagnostics.record_types[r.kind || 'unknown'] || 0) + 1;
  const totals = diagnostics.sheets.reduce((acc, s) => { acc.rows += s.rows || 0; for (const f of ['phone', 'bizDate', 'amount', 'dish']) if (s.present?.[f]) acc[f] += 1; return acc; }, { rows: 0, phone: 0, bizDate: 0, amount: 0, dish: 0 });
  diagnostics.missing_required = ['phone', 'bizDate', 'amount'].filter((f) => !totals[f]).map((f) => FIELD_DEFS[f].label);
  if (!totals.dish) diagnostics.warnings.push('未识别到菜品字段，360档案中的偏好菜和新品匹配会较弱');
  if (!totals.phone) diagnostics.warnings.push('未识别到手机号字段，只能做匿名订单诊断，无法沉淀可触达客户');
  diagnostics.confidence_score = Math.round((['phone', 'bizDate', 'amount', 'dish'].reduce((s, f) => s + (totals[f] ? 25 : 0), 0)));
  return { orders: normalized, diagnostics };
}

function analyzeOrders(orders, opts = {}) {
  const storeName = cleanText(opts.storeName || orders.find((o) => o.store)?.store || '未命名门店', 120);
  const valid = orders.filter((o) => o.amount > 0 || o.rechargeAmount > 0 || o.balance > 0 || o.phone || o.memberNo);
  const consumption = valid.filter((o) => !['stored_value', 'member_profile'].includes(o.kind) && Number(o.amount || 0) > 0);
  const customers = new Map();
  const daily = new Map();
  const weekday = { weekday: { revenue: 0, orders: 0 }, weekend: { revenue: 0, orders: 0 } };
  const daypart = { lunch: { revenue: 0, orders: 0 }, dinner: { revenue: 0, orders: 0 }, other: { revenue: 0, orders: 0 } };
  let totalRevenue = 0;
  for (const o of valid) {
    const isConsumption = !['stored_value', 'member_profile'].includes(o.kind) && Number(o.amount || 0) > 0;
    if (isConsumption) {
      totalRevenue += o.amount;
      const dk = o.bizDate || 'unknown';
      const d = daily.get(dk) || { revenue: 0, orders: 0 };
      d.revenue += o.amount; d.orders += 1; daily.set(dk, d);
      const date = o.bizDate ? new Date(`${o.bizDate}T00:00:00Z`) : null;
      const isWeekend = date && [0, 6].includes(date.getUTCDay());
      const wk = isWeekend ? weekday.weekend : weekday.weekday;
      wk.revenue += o.amount; wk.orders += 1;
      const part = o.hour >= 11 && o.hour < 14 ? daypart.lunch : (o.hour >= 17 && o.hour < 21 ? daypart.dinner : daypart.other);
      part.revenue += o.amount; part.orders += 1;
    }
    const id = o.phone || o.memberNo || `anonymous:${o.orderNo}`;
    const c = customers.get(id) || { customerId: id, phone: o.phone, memberNo: o.memberNo || '', name: o.memberName, stores: new Set(), orders: [], records: [], storedValueRecords: [], totalSpend: 0, totalRecharge: 0, totalGift: 0, latestBalance: 0, latestPoints: 0, favorite: new Map(), businessSignals: 0, familySignals: 0 };
    if (o.phone && !c.phone) c.phone = o.phone;
    if (o.memberNo && !c.memberNo) c.memberNo = o.memberNo;
    if (o.memberName && !c.name) c.name = o.memberName;
    if (o.store) c.stores.add(o.store);
    c.records.push(o);
    if (isConsumption) {
      c.orders.push(o);
      c.totalSpend += o.amount;
      if (o.diners >= 6 || /包房|宴|商务|公司/i.test(`${o.orderType}${o.tableNo}`)) c.businessSignals += 1;
      if (o.diners >= 3 && o.diners <= 5) c.familySignals += 1;
      for (const item of o.items || []) c.favorite.set(item.dish, (c.favorite.get(item.dish) || 0) + (item.qty || 1));
    }
    if (o.kind === 'stored_value' || o.rechargeAmount || o.balance) {
      c.storedValueRecords.push(o);
      c.totalRecharge += Number(o.rechargeAmount || 0);
      c.totalGift += Number(o.giftAmount || 0);
      if (Number(o.balance || 0) > 0) c.latestBalance = Number(o.balance || 0);
      if (Number(o.points || 0) > 0) c.latestPoints = Number(o.points || 0);
    }
    customers.set(id, c);
  }
  const dates = Array.from(daily.keys()).filter((x) => x !== 'unknown').sort();
  const nowTs = dates.length ? new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime() : Date.now();
  const customerRows = Array.from(customers.values()).map((c, idx) => {
    c.orders.sort((a, b) => String(a.bizDate).localeCompare(String(b.bizDate)));
    c.records.sort((a, b) => String(a.bizDate).localeCompare(String(b.bizDate)));
    c.storedValueRecords.sort((a, b) => String(a.bizDate).localeCompare(String(b.bizDate)));
    const firstDate = c.orders[0]?.bizDate || '';
    const lastDate = c.orders[c.orders.length - 1]?.bizDate || '';
    c.firstDate = firstDate; c.lastDate = lastDate;
    const intervals = [];
    for (let i = 1; i < c.orders.length; i++) {
      const a = new Date(`${c.orders[i - 1].bizDate}T00:00:00Z`).getTime();
      const b = new Date(`${c.orders[i].bizDate}T00:00:00Z`).getTime();
      if (Number.isFinite(a) && Number.isFinite(b)) intervals.push(Math.max(1, Math.round((b - a) / 86400000)));
    }
    c.avgInterval = intervals.length ? intervals.reduce((s, x) => s + x, 0) / intervals.length : 30;
    const cls = classifyCustomer(c, nowTs);
    const favorite = Array.from(c.favorite.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([dish]) => dish);
    const avgCheck = c.totalSpend / Math.max(c.orders.length, 1);
    const hourBuckets = c.orders.reduce((acc, o) => {
      const key = o.hour >= 11 && o.hour < 14 ? '午市' : (o.hour >= 17 && o.hour < 21 ? '晚市' : '其他');
      acc[key] = (acc[key] || 0) + 1; return acc;
    }, {});
    const preferredVisitTime = Object.entries(hourBuckets).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
    const lunchPct = Math.round((hourBuckets['午市'] || 0) / Math.max(c.orders.length, 1) * 100) / 100;
    const weekendCount = c.orders.filter((o) => { const d = o.bizDate ? new Date(`${o.bizDate}T00:00:00Z`) : null; return d && [0, 6].includes(d.getUTCDay()); }).length;
    const weekendPct = Math.round(weekendCount / Math.max(c.orders.length, 1) * 100) / 100;
    const cutoff90d = nowTs - 90 * 86400000;
    const cutoff30d = nowTs - 30 * 86400000;
    const spend90d = Math.round(c.orders.filter((o) => o.bizDate && new Date(`${o.bizDate}T00:00:00Z`).getTime() >= cutoff90d).reduce((s, o) => s + Number(o.amount || 0), 0) * 100) / 100;
    const maxSingleSpend = Math.round(c.orders.reduce((mx, o) => Math.max(mx, Number(o.amount || 0)), 0) * 100) / 100;
    const orders30d = c.orders.filter((o) => o.bizDate && new Date(`${o.bizDate}T00:00:00Z`).getTime() >= cutoff30d).length;
    const maxSingleDiners = c.orders.reduce((mx, o) => Math.max(mx, Number(o.diners || 0)), 0);
    const storeVisits = c.orders.reduce((acc, o) => { const key = o.store || '未知门店'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
    const primaryStore = Object.entries(storeVisits).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const lastOrders = c.orders.slice(-8).reverse().map((o) => ({ date: o.bizDate || '', store: o.store || '', amount: Math.round(Number(o.amount || 0) * 100) / 100, diners: o.diners || 0, order_type: o.orderType || '', table_no: o.tableNo || '', dishes: (o.items || []).slice(0, 6).map((it) => it.dish).filter(Boolean) }));
    const storedValueTimeline = c.storedValueRecords.slice(-8).reverse().map((o) => ({ date: o.bizDate || '', store: o.store || '', recharge_amount: Math.round(Number(o.rechargeAmount || 0) * 100) / 100, gift_amount: Math.round(Number(o.giftAmount || 0) * 100) / 100, balance: Math.round(Number(o.balance || 0) * 100) / 100, points: Math.round(Number(o.points || 0) * 100) / 100, order_type: o.orderType || '' }));
    return {
      customer_id: `C${String(idx + 1).padStart(6, '0')}`,
      customer_key: c.customerId,
      phone: c.phone, member_no: c.memberNo || '', name: c.name || '',
      stores: Array.from(c.stores), primary_store: primaryStore, store_visits: storeVisits,
      total_spend: Math.round(c.totalSpend * 100) / 100,
      total_recharge: Math.round(c.totalRecharge * 100) / 100,
      total_gift: Math.round(c.totalGift * 100) / 100,
      stored_value_balance: Math.round(c.latestBalance * 100) / 100,
      points_balance: Math.round(c.latestPoints * 100) / 100,
      order_count: c.orders.length, source_record_count: c.records.length, stored_value_count: c.storedValueRecords.length,
      avg_check: Math.round(avgCheck * 100) / 100,
      first_visit: firstDate, last_visit: lastDate, days_since_last_visit: cls.daysSince,
      favorite_dishes: favorite, preferred_visit_time: preferredVisitTime,
      lunch_pct: lunchPct, weekend_pct: weekendPct, spend_90d: spend90d,
      max_single_spend: maxSingleSpend, orders_30d: orders30d, max_single_diners: maxSingleDiners,
      last_orders: lastOrders, stored_value_timeline: storedValueTimeline,
      lifecycle_stage: cls.lifecycle,
      // 以下为客维运营页本地启发式分层；权威 VIP 口径见 growth_customer_profiles.value_tier（折前人均消费金额门店内前15%）
      value_tier: avgCheck >= 800 || c.totalSpend >= 10000 ? 'vip' : (avgCheck >= 300 || c.orders.length >= 4 ? 'regular' : 'general'),
      scene_tags: avgCheck < 200 && c.orders.length <= 3 && !c.totalRecharge ? [...cls.tags, 'price_sensitive'] : cls.tags,
      staff_note: cls.tags.includes('business') ? '商务客户' : (cls.tags.includes('family') ? '家庭聚餐客户' : ''),
      visit_status: cls.daysSince <= 14 ? '已到店' : '待维护',
      channel_readiness: { sms: !!c.phone, wecom: false, miniprogram: !!c.phone, xiaohongshu: true, dianping: true, douyin: true },
      next_best_action: cls.lifecycle === 'one_time'
        ? `首购${cls.daysSince}天未复购，建议用「${favorite[0] || '招牌菜'}」做二次到店邀请。`
        : cls.tags.includes('business') ? `商务/高客单客户，建议由店长维护，提前安排座位并推荐「${favorite[0] || '招牌菜'}」。`
          : cls.daysSince >= 30 ? `已${cls.daysSince}天未到店，建议短信/企微召回。` : '维持常规会员触达，避免过度打扰。'
    };
  }).sort((a, b) => b.total_spend - a.total_spend);
  const byLifecycle = {};
  const byScene = {};
  for (const c of customerRows) {
    byLifecycle[c.lifecycle_stage] = (byLifecycle[c.lifecycle_stage] || 0) + 1;
    for (const tag of c.scene_tags) byScene[tag] = (byScene[tag] || 0) + 1;
  }
  const dailyVals = Array.from(daily.values()).map((x) => x.revenue);
  const avgDaily = dailyVals.length ? dailyVals.reduce((s, x) => s + x, 0) / dailyVals.length : 0;
  const variance = dailyVals.length ? dailyVals.reduce((s, x) => s + Math.pow(x - avgDaily, 2), 0) / dailyVals.length : 0;
  const stability = avgDaily > 0 ? Math.max(0, 100 - Math.sqrt(variance) / avgDaily * 100) : 0;
  return {
    store_name: storeName, generated_at: new Date().toISOString(),
    input_quality: { rows: orders.length, valid_orders: valid.length, customers: customerRows.length, date_start: dates[0] || '', date_end: dates[dates.length - 1] || '', cleaning: opts.diagnostics || {} },
    business: { revenue: Math.round(totalRevenue * 100) / 100, orders: consumption.length, customers: customerRows.length, avg_check: consumption.length ? Math.round(totalRevenue / consumption.length * 100) / 100 : 0, customer_repeat_rate: customerRows.length ? customerRows.filter((c) => c.order_count > 1).length / customerRows.length : 0, revenue_stability_score: Math.round(stability), stored_value: { recharge: Math.round(customerRows.reduce((s, c) => s + Number(c.total_recharge || 0), 0) * 100) / 100, gift: Math.round(customerRows.reduce((s, c) => s + Number(c.total_gift || 0), 0) * 100) / 100, balance: Math.round(customerRows.reduce((s, c) => s + Number(c.stored_value_balance || 0), 0) * 100) / 100, customers: customerRows.filter((c) => Number(c.stored_value_count || 0) > 0).length }, daypart, weekday },
    customer_mix: { lifecycle: byLifecycle, scene: byScene, top_customers: customerRows.slice(0, 20) },
    customers: customerRows
  };
}

async function ensureCustomerOpsTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_ops_diagnoses (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', store_name TEXT, source_filename TEXT, report_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_diag_tenant_created ON customer_ops_diagnoses (tenant_id, created_at DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_ops_profiles (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', diagnosis_id BIGINT REFERENCES customer_ops_diagnoses(id) ON DELETE CASCADE, customer_id TEXT, customer_key TEXT, phone TEXT, profile_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_profiles_diag ON customer_ops_profiles (tenant_id, diagnosis_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_profiles_phone ON customer_ops_profiles (tenant_id, phone) WHERE phone IS NOT NULL AND phone <> ''`);
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_ops_source_records (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', diagnosis_id BIGINT REFERENCES customer_ops_diagnoses(id) ON DELETE CASCADE, source_filename TEXT, record_key TEXT NOT NULL, phone TEXT, member_no TEXT, record_kind TEXT, record_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, record_key))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_source_tenant_kind ON customer_ops_source_records (tenant_id, record_kind, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_ops_source_phone ON customer_ops_source_records (tenant_id, phone) WHERE phone IS NOT NULL AND phone <> ''`);

  // 模块2：自定义客群分层
  await pool.query(`CREATE TABLE IF NOT EXISTS customer_segments (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', name TEXT NOT NULL, criteria_json JSONB NOT NULL DEFAULT '{}'::jsonb, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_customer_segments_tenant ON customer_segments (tenant_id, created_at DESC)`);

  // 模块3：营销活动台账
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_campaigns (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', title TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'offline', campaign_type TEXT DEFAULT '其他', status TEXT NOT NULL DEFAULT 'planned', planned_date DATE, planned_end_date DATE, store_ids JSONB DEFAULT '[]'::jsonb, target_audience TEXT DEFAULT '', target_count INT DEFAULT 0, content TEXT DEFAULT '', goal TEXT DEFAULT '', budget NUMERIC DEFAULT 0, reminder_date DATE, source TEXT DEFAULT 'manual', created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant ON marketing_campaigns (tenant_id, planned_date DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS marketing_campaign_results (id BIGSERIAL PRIMARY KEY, tenant_id VARCHAR(80) NOT NULL DEFAULT 'default', campaign_id BIGINT REFERENCES marketing_campaigns(id) ON DELETE CASCADE, store_id TEXT NOT NULL DEFAULT '', store_name TEXT DEFAULT '', actual_send_count INT DEFAULT 0, actual_reach_count INT DEFAULT 0, actual_conversion_count INT DEFAULT 0, actual_revenue NUMERIC DEFAULT 0, result_note TEXT DEFAULT '', recorded_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mkt_campaign_results ON marketing_campaign_results (tenant_id, campaign_id)`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS actual_exposure_count INT DEFAULT 0`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS actual_redemption_count INT DEFAULT 0`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS actual_cost NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS effect_rating TEXT DEFAULT ''`);

  await pool.query(`CREATE TABLE IF NOT EXISTS anomaly_triggers (id SERIAL PRIMARY KEY, anomaly_key TEXT NOT NULL, store TEXT NOT NULL, brand TEXT, severity TEXT NOT NULL DEFAULT 'medium', trigger_date DATE NOT NULL, trigger_value JSONB DEFAULT '{}'::jsonb, threshold_value JSONB DEFAULT '{}'::jsonb, task_id TEXT, status TEXT DEFAULT 'open', assigned_role TEXT, notify_target_role TEXT, evidence_submitted JSONB DEFAULT '[]'::jsonb, resolution_code TEXT, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_anomaly_triggers_tenant_date ON anomaly_triggers (tenant_id, trigger_date DESC)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS training_assignments (id SERIAL PRIMARY KEY, employee_username VARCHAR(100) NOT NULL, topic_id INTEGER NOT NULL DEFAULT 0, assigned_by VARCHAR(100), due_date DATE, note TEXT, created_at TIMESTAMP DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_assignments_tenant_created ON training_assignments (tenant_id, created_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS training_sessions (id SERIAL PRIMARY KEY, employee_username VARCHAR(100) NOT NULL, topic_id INTEGER NOT NULL DEFAULT 0, quiz_passed BOOLEAN DEFAULT FALSE, status VARCHAR(20) DEFAULT 'learning', started_at TIMESTAMP DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_sessions_tenant_started ON training_sessions (tenant_id, started_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS training_certifications (id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL DEFAULT 0, employee_username VARCHAR(100) NOT NULL, topic_id INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_training_certifications_tenant_created ON training_certifications (tenant_id, created_at)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agent_scores (id SERIAL PRIMARY KEY, username TEXT, total_score NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), tenant_id VARCHAR(80) NOT NULL DEFAULT 'default')`);
  await pool.query(`ALTER TABLE agent_scores ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agent_scores_tenant_created ON agent_scores (tenant_id, created_at)`);
}

async function latestDiagnosis(pool, tenantId, diagnosisId = 0) {
  if (diagnosisId) {
    const r = await pool.query(`SELECT * FROM customer_ops_diagnoses WHERE id = $1 AND tenant_id = $2`, [diagnosisId, tenantId]);
    return r.rows[0] || null;
  }
  const r = await pool.query(`SELECT * FROM customer_ops_diagnoses WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`, [tenantId]);
  return r.rows[0] || null;
}

function runPdfGenerator(report, outputPath) {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'scripts', 'customer_ops_pdf.py');
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [script, outputPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(err || `pdf_failed_${code}`)));
    child.stdin.write(JSON.stringify(report));
    child.stdin.end();
  });
}

function runCampaignReportPdfGenerator(payload, outputPath) {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'scripts', 'campaign_report_pdf.py');
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [script, outputPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(err || `pdf_failed_${code}`)));
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

// 自动营销发送(growth_delivery_logs)按 规则+日期 聚合生成一条营销活动台账记录，
// 标注 source='auto'，让维护导航舱能看到系统自动执行的常态化触达，而不只是手动策划的活动。
async function syncAutoCampaignsFromDeliveryLogs(pool, tenantId) {
  await pool.query(`ALTER TABLE marketing_campaigns ADD COLUMN IF NOT EXISTS rule_key TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_campaigns_auto ON marketing_campaigns (tenant_id, rule_key, planned_date) WHERE source='auto' AND rule_key IS NOT NULL`);
  await pool.query(`ALTER TABLE marketing_campaign_results ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_campaign_results_auto ON marketing_campaign_results (campaign_id, store_id) WHERE source='auto'`);

  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const grouped = await pool.query(
    `SELECT dl.rule_key, tr.name AS rule_name, dl.created_at::date AS day,
            COUNT(*) AS send_count,
            array_agg(DISTINCT dl.store_id) FILTER (WHERE dl.store_id IS NOT NULL AND dl.store_id <> '') AS store_ids,
            MAX(dl.channel) AS channel,
            MAX(dl.payload->>'message') AS sample_message
       FROM growth_delivery_logs dl
       LEFT JOIN growth_touch_rules tr ON tr.rule_key = dl.rule_key
      WHERE dl.tenant_id = $1 AND dl.status = 'sent' AND dl.rule_key IS NOT NULL AND dl.rule_key <> ''
        AND dl.created_at >= $2::date
      GROUP BY dl.rule_key, tr.name, dl.created_at::date`,
    [tenantId, since]
  ).catch(() => ({ rows: [] }));

  for (const row of grouped.rows) {
    const storeIds = row.store_ids || [];
    const existingCampaign = await pool.query(
      `SELECT id FROM marketing_campaigns
        WHERE tenant_id=$1 AND source='auto' AND rule_key=$2 AND planned_date=$3::date
        ORDER BY id ASC LIMIT 1`,
      [tenantId, row.rule_key, row.day]
    );
    let campaignId = existingCampaign.rows[0]?.id;
    if (campaignId) {
      await pool.query(
        `UPDATE marketing_campaigns
            SET title=$2, channel=$3, store_ids=$4::jsonb, target_count=$5, content=$6, updated_at=NOW()
          WHERE id=$1 AND tenant_id=$7`,
        [campaignId, row.rule_name || row.rule_key, row.channel || 'wecom', JSON.stringify(storeIds), Number(row.send_count || 0), row.sample_message || '', tenantId]
      );
    } else {
      const campaignRes = await pool.query(
        `INSERT INTO marketing_campaigns (tenant_id, title, channel, campaign_type, status, planned_date, planned_end_date, store_ids, target_audience, target_count, content, goal, source, rule_key, created_by)
         VALUES ($1,$2,$3,'自动营销','completed',$4,$4,$5::jsonb,'系统规则自动圈选',$6,$7,'系统按预设规则自动执行的常态化营销触达','auto',$8,'system')
         RETURNING id`,
        [tenantId, row.rule_name || row.rule_key, row.channel || 'wecom', row.day, JSON.stringify(storeIds), Number(row.send_count || 0), row.sample_message || '', row.rule_key]
      );
      campaignId = campaignRes.rows[0].id;
    }

    const perStore = await pool.query(
      `SELECT COALESCE(NULLIF(dl.store_id, ''), '') AS store_id, COUNT(*) AS send_count
         FROM growth_delivery_logs dl
        WHERE dl.tenant_id = $1 AND dl.status = 'sent' AND dl.rule_key = $2 AND dl.created_at::date = $3::date
        GROUP BY dl.store_id`,
      [tenantId, row.rule_key, row.day]
    );
    for (const sr of perStore.rows) {
      const existingResult = await pool.query(
        `SELECT id FROM marketing_campaign_results
          WHERE tenant_id=$1 AND campaign_id=$2 AND store_id=$3 AND source='auto'
          ORDER BY id ASC LIMIT 1`,
        [tenantId, campaignId, sr.store_id]
      );
      if (existingResult.rows[0]?.id) {
        await pool.query(
          `UPDATE marketing_campaign_results
              SET store_name=$2, actual_send_count=$3, updated_at=NOW()
            WHERE id=$1 AND tenant_id=$4`,
          [existingResult.rows[0].id, sr.store_id, Number(sr.send_count || 0), tenantId]
        );
      } else {
        await pool.query(
          `INSERT INTO marketing_campaign_results (tenant_id, campaign_id, store_id, store_name, actual_send_count, source, recorded_by)
           VALUES ($1,$2,$3,$3,$4,'auto','system')`,
          [tenantId, campaignId, sr.store_id, Number(sr.send_count || 0)]
        );
      }
    }
  }
}

// 把已评级的活动复盘结果沉淀到经验库(growth_learnings)，供AI内容建议引擎下一轮复用。
async function saveCampaignResultAsLearning(pool, tenantId, campaign, result) {
  if (!campaign || !result || !result.effect_rating) return;
  const send = Number(result.actual_send_count || 0);
  const redeem = Number(result.actual_redemption_count || 0);
  const revenue = Number(result.actual_revenue || 0);
  const cost = Number(result.actual_cost || 0);
  const rate = send > 0 ? `${(redeem / send * 100).toFixed(1)}%` : '-';
  const roi = cost > 0 ? ((revenue - cost) / cost).toFixed(2) : '-';
  const effectLabel = { excellent: '优秀', meets: '达标', below: '不达标', blacklist: '黑名单(不建议再用)' }[result.effect_rating] || result.effect_rating;
  const confidence = result.effect_rating === 'excellent' ? 'high' : result.effect_rating === 'blacklist' ? 'high' : 'medium';
  const effectDesc = `活动「${campaign.title}」(${campaign.campaign_type || '其他'}/${campaign.channel || '-'})：`
    + `发送${send}人，核销${redeem}单(核销率${rate})，带动收入¥${revenue.toFixed(0)}，成本¥${cost.toFixed(0)}，ROI ${roi}。`
    + `效果评级：${effectLabel}。${result.result_note ? '备注：' + cleanText(result.result_note, 300) : ''}`;
  await pool.query(
    `INSERT INTO growth_learnings (source_type, source_id, store_code, channel, scene, audience_tag, variable, winning_value, losing_value, effect_desc, sample_size, confidence, is_verified, tenant_id)
     VALUES ('marketing_campaign', $1, $2, $3, $4, $5, $6, $7, '', $8, $9, $10, true, $11)
     ON CONFLICT (source_type, source_id, tenant_id) WHERE source_id IS NOT NULL AND source_id <> '' DO UPDATE SET
       store_code = EXCLUDED.store_code, channel = EXCLUDED.channel, effect_desc = EXCLUDED.effect_desc,
       sample_size = EXCLUDED.sample_size, confidence = EXCLUDED.confidence, updated_at = NOW()`,
    [
      String(campaign.id),
      cleanText(result.store_name || result.store_id || '', 80),
      cleanText(campaign.channel || '', 40),
      cleanText(campaign.campaign_type || '', 40),
      cleanText(campaign.target_audience || '', 200),
      `活动类型:${campaign.campaign_type || '其他'}`,
      cleanText(campaign.title || '', 200),
      effectDesc,
      send,
      confidence,
      tenantId,
    ]
  ).catch((e) => console.warn('[customer-ops] save learning failed:', e?.message));
}

function maskAttributionPhone(phone) {
  const s = cleanPhone(phone);
  if (s.length !== 11) return '';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

function classifyAttributionAudience(row) {
  const text = `${row.campaign_type || ''} ${row.target_audience || ''} ${row.rule_key || ''} ${row.title || ''}`.toLowerCase();
  if (/vip|高价值|大客户/.test(text)) return '高价值客户';
  if (/储值|余额|充值/.test(text)) return '储值客户';
  if (/新客|二次|复购|one_time/.test(text)) return '新客二次回店';
  if (/生日|birth/.test(text)) return '生日客户';
  if (/沉睡|流失|召回|dormant|churn|risk/.test(text)) return '沉睡/流失召回';
  if (/自动|auto|规则/.test(text)) return '自动营销客户';
  return '其他维护客户';
}

function attributionCostExpr(channelExpr = 'channel') {
  return `CASE WHEN lower(COALESCE(${channelExpr}, '')) IN ('sms', '短信') THEN 0.05 ELSE 0 END`;
}

function friendlyAttributionTitle(value) {
  const s = cleanText(value || '', 200);
  const map = {
    active: '活跃客户维护',
    dormant: '沉睡客户召回',
    churned: '流失客户召回',
    one_time: '新客二次回店',
    vip: 'VIP客户维护',
    vip_gift: 'VIP客户权益邀约',
    mj_dinner_weekend: '周末晚市客户邀约',
    dormant_90_180: '沉睡90-180天客户召回',
    stored_value: '储值客户维护',
  };
  return map[s] || s || '自动营销触达';
}

async function buildAttributionReport(pool, tenantId, opts = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dateFrom = cleanText(opts.dateFrom || (today.slice(0, 8) + '01'), 20);
  const dateTo = cleanText(opts.dateTo || today, 20);
  const storeId = cleanText(opts.storeId || '', 80);
  const windowDays = Math.max(1, Math.min(60, Number(opts.windowDays || 14)));
  const storeFilter = await resolveCustomerOpsStoreFilter(pool, tenantId, storeId);

  await ensureCustomerOpsTables(pool);
  await syncAutoCampaignsFromDeliveryLogs(pool, tenantId).catch((e) => console.warn('[customer-ops] auto campaign sync failed:', e?.message));

  const touchParams = [tenantId, dateFrom, dateTo, storeFilter.posStoreIds, storeId];
  const touchesSql = `
    SELECT
      ('auto:' || COALESCE(NULLIF(dl.rule_key, ''), NULLIF(dl.action_key, ''), 'unknown') || ':' || dl.created_at::date::text) AS campaign_id,
      COALESCE(tr.name, NULLIF(dl.rule_key, ''), NULLIF(dl.action_key, ''), '自动营销触达') AS title,
      COALESCE(NULLIF(dl.channel, ''), 'unknown') AS channel,
      '自动营销' AS campaign_type,
      '系统规则圈选客户' AS target_audience,
      COALESCE(NULLIF(dl.rule_key, ''), '') AS rule_key,
      COALESCE(NULLIF(dl.store_id, ''), '') AS store_id,
      clean_phone.phone AS phone,
      dl.customer_id,
      dl.created_at AS touched_at,
      ${attributionCostExpr('dl.channel')}::numeric AS touch_cost
    FROM growth_delivery_logs dl
    LEFT JOIN growth_touch_rules tr ON tr.rule_key = dl.rule_key
    CROSS JOIN LATERAL (
      SELECT regexp_replace(COALESCE(dl.payload->>'phone', ''), '[^0-9]', '', 'g') AS phone
    ) clean_phone
    WHERE dl.tenant_id = $1
      AND dl.status = 'sent'
      AND dl.created_at::date >= $2::date
      AND dl.created_at::date <= $3::date
      AND ($5::text = '' OR dl.store_id = $5 OR dl.store_id = ANY($4::text[]))
      AND clean_phone.phone <> ''
  `;
  const attributedSql = `
    WITH touches AS (${touchesSql})
    SELECT DISTINCT ON (po.order_no)
      t.campaign_id,
      t.title,
      t.channel,
      t.campaign_type,
      t.target_audience,
      t.rule_key,
      COALESCE(NULLIF(t.store_id, ''), po.store_id, '') AS store_id,
      po.store_name,
      t.phone,
      t.customer_id,
      t.touched_at,
      po.order_no,
      po.biz_date,
      po.table_no,
      po.diners,
      COALESCE(po.amount_after_discount, 0)::numeric AS revenue,
      COALESCE(po.amount_before_discount, 0)::numeric AS pre_discount_revenue,
      ABS(COALESCE(po.total_discount, 0)::numeric) AS discount_amount
    FROM touches t
    JOIN pos_orders po
      ON (regexp_replace(COALESCE(po.phone, ''), '[^0-9]', '', 'g') = t.phone OR (t.customer_id IS NOT NULL AND po.customer_id = t.customer_id))
     AND po.biz_date >= $2::date
     AND po.biz_date <= $3::date
     AND ($5::text = '' OR po.store_id = ANY($4::text[]))
    WHERE po.order_no IS NOT NULL AND po.order_no <> ''
    ORDER BY po.order_no, t.touched_at DESC
  `;
  const params = touchParams;

  const [touchSummary, attributedSummary, byCampaign, byStore, byTypeRaw, trend, topCustomers, orderRecords, manualSummary] = await Promise.all([
    pool.query(`WITH touches AS (${touchesSql}) SELECT COUNT(*)::int AS touch_count, COUNT(DISTINCT phone)::int AS touched_customers, COALESCE(SUM(touch_cost), 0)::numeric AS touch_cost FROM touches`, touchParams),
    pool.query(`WITH attributed AS (${attributedSql}) SELECT COUNT(DISTINCT order_no)::int AS attributed_orders, COUNT(DISTINCT phone)::int AS returned_customers, COALESCE(SUM(revenue), 0)::numeric AS attributed_revenue, COALESCE(SUM(pre_discount_revenue), 0)::numeric AS attributed_pre_discount_revenue, COALESCE(SUM(discount_amount), 0)::numeric AS discount_amount FROM attributed`, params),
    pool.query(`
      WITH touches AS (${touchesSql}), attributed AS (${attributedSql}),
      touch_agg AS (
        SELECT campaign_id, MAX(title) AS title, MAX(channel) AS channel, MAX(campaign_type) AS campaign_type,
               MAX(target_audience) AS target_audience, MAX(rule_key) AS rule_key, COUNT(*)::int AS touches,
               COUNT(DISTINCT phone)::int AS touched_customers, COALESCE(SUM(touch_cost), 0)::numeric AS touch_cost
        FROM touches GROUP BY campaign_id
      ),
      attr_agg AS (
        SELECT campaign_id, COUNT(DISTINCT order_no)::int AS orders, COUNT(DISTINCT phone)::int AS returned_customers,
               COALESCE(SUM(revenue), 0)::numeric AS revenue, COALESCE(SUM(pre_discount_revenue), 0)::numeric AS pre_discount_revenue,
               COALESCE(SUM(discount_amount), 0)::numeric AS discount_amount
        FROM attributed GROUP BY campaign_id
      )
      SELECT t.*, COALESCE(a.orders, 0)::int AS attributed_orders, COALESCE(a.returned_customers, 0)::int AS returned_customers,
             COALESCE(a.revenue, 0)::numeric AS attributed_revenue, COALESCE(a.pre_discount_revenue, 0)::numeric AS attributed_pre_discount_revenue,
             COALESCE(a.discount_amount, 0)::numeric AS discount_amount
      FROM touch_agg t LEFT JOIN attr_agg a ON a.campaign_id = t.campaign_id
      ORDER BY COALESCE(a.revenue, 0) DESC, t.touched_customers DESC LIMIT 50`, params),
    pool.query(`
      WITH touches AS (${touchesSql}), attributed AS (${attributedSql}),
      touch_agg AS (
        SELECT COALESCE(NULLIF(store_id, ''), '全部/未知') AS store_id, COUNT(*)::int AS touches,
               COUNT(DISTINCT phone)::int AS touched_customers, COALESCE(SUM(touch_cost), 0)::numeric AS touch_cost
        FROM touches GROUP BY COALESCE(NULLIF(store_id, ''), '全部/未知')
      ),
      attr_agg AS (
        SELECT COALESCE(NULLIF(store_id, ''), '全部/未知') AS store_id, MAX(store_name) AS store_name,
               COUNT(DISTINCT order_no)::int AS orders, COUNT(DISTINCT phone)::int AS returned_customers,
               COALESCE(SUM(revenue), 0)::numeric AS revenue
        FROM attributed GROUP BY COALESCE(NULLIF(store_id, ''), '全部/未知')
      )
      SELECT t.store_id, COALESCE(a.store_name, t.store_id) AS store_name, t.touches, t.touched_customers, t.touch_cost,
             COALESCE(a.orders, 0)::int AS attributed_orders, COALESCE(a.returned_customers, 0)::int AS returned_customers,
             COALESCE(a.revenue, 0)::numeric AS attributed_revenue
      FROM touch_agg t LEFT JOIN attr_agg a ON a.store_id = t.store_id
      ORDER BY COALESCE(a.revenue, 0) DESC, t.touched_customers DESC LIMIT 30`, params),
    pool.query(`WITH attributed AS (${attributedSql}) SELECT campaign_type, target_audience, rule_key, title, COUNT(DISTINCT phone)::int AS returned_customers, COUNT(DISTINCT order_no)::int AS attributed_orders, COALESCE(SUM(revenue), 0)::numeric AS attributed_revenue FROM attributed GROUP BY campaign_type, target_audience, rule_key, title`, params),
    pool.query(`
      WITH touches AS (${touchesSql}), attributed AS (${attributedSql}),
      touch_day AS (SELECT touched_at::date AS day, COUNT(DISTINCT phone)::int AS touched_customers FROM touches GROUP BY touched_at::date),
      attr_day AS (SELECT biz_date AS day, COUNT(DISTINCT phone)::int AS returned_customers, COUNT(DISTINCT order_no)::int AS orders, COALESCE(SUM(revenue), 0)::numeric AS revenue FROM attributed GROUP BY biz_date)
      SELECT COALESCE(t.day, a.day) AS day, COALESCE(t.touched_customers, 0)::int AS touched_customers, COALESCE(a.returned_customers, 0)::int AS returned_customers, COALESCE(a.orders, 0)::int AS attributed_orders, COALESCE(a.revenue, 0)::numeric AS attributed_revenue
      FROM touch_day t FULL JOIN attr_day a ON a.day = t.day ORDER BY day ASC`, params),
    pool.query(`
      WITH attributed AS (${attributedSql})
      SELECT phone, MAX(store_name) AS store_name, MAX(store_id) AS store_id, MAX(touched_at)::date AS last_touch_date,
             MAX(biz_date) AS last_order_date, COUNT(DISTINCT order_no)::int AS attributed_orders,
             COALESCE(SUM(revenue), 0)::numeric AS attributed_revenue
      FROM attributed GROUP BY phone ORDER BY attributed_revenue DESC LIMIT 20`, params),
    pool.query(`
      WITH attributed AS (${attributedSql})
      SELECT phone, biz_date, store_id, store_name, table_no, diners, order_no, revenue, pre_discount_revenue, discount_amount
      FROM attributed
      ORDER BY biz_date DESC, revenue DESC
      LIMIT 80`, params),
    pool.query(`
      SELECT COALESCE(SUM(c.target_count), 0)::int AS suggested_customers, COUNT(*)::int AS campaign_count,
             COALESCE(SUM(c.budget), 0)::numeric AS planned_budget, COALESCE(SUM(r.actual_send_count), 0)::int AS manual_send_count,
             COALESCE(SUM(r.actual_revenue), 0)::numeric AS manual_revenue, COALESCE(SUM(r.actual_cost), 0)::numeric AS manual_cost
      FROM marketing_campaigns c
      LEFT JOIN marketing_campaign_results r ON r.campaign_id = c.id AND r.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1 AND COALESCE(c.planned_date, c.created_at::date) >= $2::date AND COALESCE(c.planned_date, c.created_at::date) <= $3::date
        AND ($5::text = '' OR c.store_ids = '[]'::jsonb OR c.store_ids @> to_jsonb(ARRAY[$5::text]) OR c.store_ids ?| $4::text[])`, touchParams),
  ]);

  const ts = touchSummary.rows[0] || {};
  const as = attributedSummary.rows[0] || {};
  const manual = manualSummary.rows[0] || {};
  const touchedCustomers = Number(ts.touched_customers || 0);
  const touchCount = Number(ts.touch_count || 0);
  const returnedCustomers = Number(as.returned_customers || 0);
  const attributedRevenue = Number(as.attributed_revenue || 0);
  const touchCost = Number(ts.touch_cost || 0) || Number(manual.manual_cost || 0);
  const byTypeMap = new Map();
  for (const row of byTypeRaw.rows) {
    const label = classifyAttributionAudience(row);
    const before = byTypeMap.get(label) || { customer_type: label, returned_customers: 0, attributed_orders: 0, attributed_revenue: 0 };
    before.returned_customers += Number(row.returned_customers || 0);
    before.attributed_orders += Number(row.attributed_orders || 0);
    before.attributed_revenue += Number(row.attributed_revenue || 0);
    byTypeMap.set(label, before);
  }
  const customerTypeRows = Array.from(byTypeMap.values()).sort((a, b) => b.attributed_revenue - a.attributed_revenue);
  const campaignRows = byCampaign.rows.map((r) => {
    const cost = Number(r.touch_cost || 0);
    const revenue = Number(r.attributed_revenue || 0);
    return { ...r, title: friendlyAttributionTitle(r.title), customer_type: classifyAttributionAudience(r), touches: Number(r.touches || 0), touched_customers: Number(r.touched_customers || 0), returned_customers: Number(r.returned_customers || 0), return_rate: Number(r.touched_customers || 0) > 0 ? Number(r.returned_customers || 0) / Number(r.touched_customers || 0) : 0, attributed_orders: Number(r.attributed_orders || 0), attributed_revenue: revenue, attributed_pre_discount_revenue: Number(r.attributed_pre_discount_revenue || 0), discount_amount: Number(r.discount_amount || 0), touch_cost: cost, roi: cost > 0 ? revenue / cost : null };
  });
  const bestType = customerTypeRows[0] || null;
  const bestCampaign = campaignRows[0] || null;
  const nextMonthRecommendations = [
    '活跃客户维护投入产出比最高，建议下月继续加大触达。',
    '沉睡/流失客户回店率偏低，建议改为更强权益或人工企微跟进。',
    'VIP客户订单客单较高，建议单独建立店长一对一维护池。',
    bestType ? `优先加码「${bestType.customer_type}」：本期贡献归因实收¥${Math.round(bestType.attributed_revenue).toLocaleString()}，下月建议扩大同类客群触达并保留对照组。` : '先补齐触达日志与手机号匹配数据，保证下月能完整核算客户回店和收入。',
    bestCampaign ? `复用高效活动「${bestCampaign.title}」：回店${bestCampaign.returned_customers}人、归因实收¥${Math.round(bestCampaign.attributed_revenue).toLocaleString()}，建议复制到相似门店并微调权益。` : '活动执行后必须沉淀触达客户名单、渠道和成本，否则无法证明ROI。',
    Number(as.discount_amount || 0) > 0 ? `控制优惠效率：本期归因优惠金额¥${Math.round(Number(as.discount_amount || 0)).toLocaleString()}，下月按客群拆分不同券额，避免高价值客户过度让利。` : '下月建议记录优惠券/折扣金额，形成“优惠成本 -> 回店营业额 -> ROI”的完整链路。',
    touchedCustomers > 0 && returnedCustomers / touchedCustomers < 0.08 ? '回店率偏低时，优先优化触达时机和利益点，不建议单纯扩大群发人数。' : '保持触达节奏，重点追踪触达后7/14/30天回店差异，找到最适合品牌的归因窗口。'
  ];

  return {
    ok: true,
    report: {
      title: 'AI自动营销归因报表',
      period: { date_from: dateFrom, date_to: dateTo, store_id: storeId, store_filter: storeFilter.displayName, window_days: windowDays, generated_at: new Date().toISOString() },
      summary: {
        campaign_count: Number(manual.campaign_count || 0),
        ai_suggested_customers: Number(manual.suggested_customers || 0),
        touch_count: touchCount,
        touched_customers: touchedCustomers,
        touch_rate: touchCount > 0 ? touchedCustomers / touchCount : 0,
        returned_customers: returnedCustomers,
        return_rate: touchedCustomers > 0 ? returnedCustomers / touchedCustomers : 0,
        attributed_orders: Number(as.attributed_orders || 0),
        attributed_revenue: attributedRevenue,
        attributed_pre_discount_revenue: Number(as.attributed_pre_discount_revenue || 0),
        discount_amount: Number(as.discount_amount || 0),
        touch_cost: touchCost,
        roi: touchCost > 0 ? attributedRevenue / touchCost : null,
        manual_recorded_revenue: Number(manual.manual_revenue || 0),
      },
      by_customer_type: customerTypeRows,
      by_campaign: campaignRows,
      by_store: byStore.rows.map((r) => {
        const touched = Number(r.touched_customers || 0);
        const returned = Number(r.returned_customers || 0);
        const cost = Number(r.touch_cost || 0);
        const revenue = Number(r.attributed_revenue || 0);
        return { ...r, touched_customers: touched, returned_customers: returned, return_rate: touched > 0 ? returned / touched : 0, attributed_orders: Number(r.attributed_orders || 0), attributed_revenue: revenue, touch_cost: cost, roi: cost > 0 ? revenue / cost : null };
      }),
      trend: trend.rows.map((r) => ({ date: r.day ? String(r.day).slice(0, 10) : '', touched_customers: Number(r.touched_customers || 0), returned_customers: Number(r.returned_customers || 0), attributed_orders: Number(r.attributed_orders || 0), attributed_revenue: Number(r.attributed_revenue || 0) })),
      top_customers: topCustomers.rows.map((r) => ({ phone: maskAttributionPhone(r.phone), store_id: r.store_id || '', store_name: r.store_name || r.store_id || '', last_touch_date: r.last_touch_date ? String(r.last_touch_date).slice(0, 10) : '', last_order_date: r.last_order_date ? String(r.last_order_date).slice(0, 10) : '', attributed_orders: Number(r.attributed_orders || 0), attributed_revenue: Number(r.attributed_revenue || 0) })),
      order_records: orderRecords.rows.map((r) => ({ phone: maskAttributionPhone(r.phone), date: r.biz_date ? String(r.biz_date).slice(0, 10) : '', store_id: r.store_id || '', store_name: r.store_name || r.store_id || '', table_no: r.table_no || '', diners: Number(r.diners || 0), order_no: r.order_no || '', revenue: Number(r.revenue || 0), pre_discount_revenue: Number(r.pre_discount_revenue || 0), discount_amount: Number(r.discount_amount || 0) })),
      evidenceDetails: orderRecords.rows.map((r) => ({
        customerId: maskAttributionPhone(r.phone),
        customerName: '',
        campaignId: '',
        touchTime: '',
        channel: '',
        couponId: '',
        relatedOrderId: r.order_no || '',
        orderTime: r.biz_date ? String(r.biz_date).slice(0, 10) : '',
        orderAmount: Number(r.revenue || 0),
        attributionType: Number(r.discount_amount || 0) > 0 ? 'coupon' : 'assisted',
        couponUsed: Number(r.discount_amount || 0) > 0,
        attributionWindowDays: windowDays,
      })),
      recommendations: nextMonthRecommendations,
      methodology: {
        attribution_rule: `统计周期内，收银订单会员手机号或会员ID与本期已发送客户一致，即计入归因结果；同一订单只归因一次。`,
        revenue_rule: '归因营业额采用收银订单实收金额；同时保留折前营业额供复核。',
        roi_rule: '短信按0.05元/条估算触达成本；企微/小程序等零边际触达成本记为0，投入产出比为归因实收营业额/触达成本。',
        caution: '归因营业额代表被触达客户在归因周期内回店产生的消费，不等同于严格实验意义上的真实新增营业额。'
      }
    }
  };
}

async function safeReportQuery(pool, sql, params = [], fallback = []) {
  try {
    const r = await pool.query(sql, params);
    return r.rows || [];
  } catch (e) {
    console.warn('[customer-ops] report query skipped:', e?.message);
    return fallback;
  }
}

async function applyReportMetricFacts(pool, tenantId, report, reportType, storeId) {
  if (!report || !reportType) return report;
  const rows = await safeReportQuery(pool, `
    SELECT record_json
      FROM customer_ops_source_records
     WHERE tenant_id = $1
       AND record_kind = 'report_metric_fact'
       AND record_json->>'reportType' = $2
       AND COALESCE(record_json->>'storeId', '') = $3
     ORDER BY id ASC`,
    [tenantId || 'default', reportType, cleanText(storeId || '', 80)],
    []
  );
  for (const row of rows) {
    const fact = row.record_json || {};
    const metrics = fact.metrics && typeof fact.metrics === 'object' ? fact.metrics : {};
    const period = cleanText(fact.period || 'current', 20);
    if (period === 'previous') {
      report.previous_period = { ...(report.previous_period || {}), ...metrics };
      report.summary = { ...(report.summary || {}) };
      for (const [key, value] of Object.entries(metrics)) report.summary[`previous_${key}`] = value;
    } else {
      report.summary = { ...(report.summary || {}), ...metrics };
    }
  }
  return report;
}

async function buildCustomerAssetReport(pool, tenantId, opts = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dateFrom = cleanText(opts.dateFrom || (today.slice(0, 8) + '01'), 20);
  const dateTo = cleanText(opts.dateTo || today, 20);
  const storeId = cleanText(opts.storeId || '', 80);
  const fromDate = new Date(`${dateFrom}T00:00:00+08:00`);
  const toDate = new Date(`${dateTo}T00:00:00+08:00`);
  const periodDays = Math.max(1, Math.round((toDate - fromDate) / 86400000) + 1);
  const prevTo = new Date(fromDate.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (periodDays - 1) * 86400000);
  const prevDateFrom = prevFrom.toISOString().slice(0, 10);
  const prevDateTo = prevTo.toISOString().slice(0, 10);
  const storeFilter = await resolveCustomerOpsStoreFilter(pool, tenantId, storeId);
  const params = [dateFrom, dateTo, storeId, storeFilter.posStoreIds, storeFilter.posStoreNames, storeFilter.posStorePatterns];
  const assetSql = `
    WITH period_orders AS (
      SELECT phone, customer_id, store_id, amount_after_discount, biz_date
      FROM pos_orders
      WHERE biz_date >= $1::date AND biz_date <= $2::date
        AND ${posStoreFilterSql()}
    ),
    current_customers AS (
      SELECT DISTINCT COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text) AS cid,
             MIN(biz_date) AS first_date, MAX(biz_date) AS last_date,
             COUNT(*)::int AS orders, SUM(amount_after_discount)::numeric AS revenue
      FROM period_orders
      WHERE phone IS NOT NULL OR customer_id IS NOT NULL
      GROUP BY COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text)
    ),
    before_orders AS (
      SELECT DISTINCT COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text) AS cid
      FROM pos_orders
      WHERE biz_date < $1::date AND ${posStoreFilterSql()}
        AND (phone IS NOT NULL OR customer_id IS NOT NULL)
    ),
    dormant_before AS (
      SELECT COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text) AS cid, MAX(biz_date) AS last_before
      FROM pos_orders
      WHERE biz_date < $1::date AND ${posStoreFilterSql()}
        AND (phone IS NOT NULL OR customer_id IS NOT NULL)
      GROUP BY COALESCE(NULLIF(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'), ''), customer_id::text)
    ),
    classified AS (
      SELECT c.*,
             CASE
               WHEN revenue >= 1000 OR orders >= 3 THEN '高价值客户'
               WHEN db.last_before < $1::date - INTERVAL '60 days' THEN '沉睡唤醒客户'
               WHEN orders >= 2 THEN '复购客户'
               WHEN b.cid IS NULL THEN '新增客户'
               ELSE '其他可识别客户'
             END AS primary_segment,
             CASE WHEN b.cid IS NULL THEN 1 ELSE 0 END AS is_new,
             CASE WHEN orders >= 2 THEN 1 ELSE 0 END AS is_repeat,
             CASE WHEN last_date >= $2::date - INTERVAL '30 days' THEN 1 ELSE 0 END AS is_active,
             CASE WHEN db.last_before < $1::date - INTERVAL '60 days' THEN 1 ELSE 0 END AS is_reactivated,
             CASE WHEN revenue >= 1000 OR orders >= 3 THEN 1 ELSE 0 END AS is_vip
      FROM current_customers c
      LEFT JOIN before_orders b ON b.cid = c.cid
      LEFT JOIN dormant_before db ON db.cid = c.cid
    )
    SELECT
      COUNT(*)::int AS identifiable_customers,
      SUM(is_new)::int AS new_customers,
      SUM(is_repeat)::int AS repeat_customers,
      SUM(is_active)::int AS active_customers,
      SUM(is_reactivated)::int AS dormant_reactivated,
      SUM(is_vip)::int AS vip_customers,
      COALESCE(SUM(revenue),0)::numeric AS customer_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='新增客户'),0)::numeric AS new_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='复购客户'),0)::numeric AS repeat_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='高价值客户'),0)::numeric AS vip_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='沉睡唤醒客户'),0)::numeric AS reactivated_revenue,
      COALESCE(SUM(revenue) FILTER (WHERE primary_segment='其他可识别客户'),0)::numeric AS other_revenue,
      COUNT(*) FILTER (WHERE primary_segment='新增客户')::int AS new_primary_customers,
      COUNT(*) FILTER (WHERE primary_segment='复购客户')::int AS repeat_primary_customers,
      COUNT(*) FILTER (WHERE primary_segment='高价值客户')::int AS vip_primary_customers,
      COUNT(*) FILTER (WHERE primary_segment='沉睡唤醒客户')::int AS reactivated_primary_customers,
      COUNT(*) FILTER (WHERE primary_segment='其他可识别客户')::int AS other_primary_customers
    FROM classified`;
  const rows = await safeReportQuery(pool, assetSql, params, [{}]);
  const prevRows = await safeReportQuery(pool, assetSql, [prevDateFrom, prevDateTo, storeId, storeFilter.posStoreIds, storeFilter.posStoreNames, storeFilter.posStorePatterns], [{}]);
  const s = rows[0] || {};
  const ps = prevRows[0] || {};
  const active = Number(s.active_customers || 0);
  const dormantReactivated = Number(s.dormant_reactivated || 0);
  const identifiable = Number(s.identifiable_customers || 0);
  const newCustomers = Number(s.new_customers || 0);
  const repeatCustomers = Number(s.repeat_customers || 0);
  const vipCustomers = Number(s.vip_customers || 0);
  const customerRevenue = Number(s.customer_revenue || 0);
  const prevActive = Number(ps.active_customers || 0);
  const newDormantCustomers = Math.max(0, Number(ps.active_customers || 0) - active);
  const netAssetGrowth = newCustomers + dormantReactivated + Math.max(0, active - prevActive) - newDormantCustomers;
  const pctChange = (current, prev) => Number(prev || 0) > 0 ? (Number(current || 0) - Number(prev || 0)) / Number(prev || 0) : null;
  const assetSummary = customerRevenue >= Number(ps.customer_revenue || 0)
    ? '本期客户资产保持增长，说明客户池正在变厚。下月重点应继续放大新客二次复购和高价值客户维护。'
    : '本期新增客户不少，但老客活跃和贡献下滑，说明客户资产正在“进得来、留不住”。下月重点应放在新客二次复购和高价值客户维护。';
  return { ok: true, report: {
    title: 'AI客户资产增长报告',
    executive_summary: assetSummary,
    period: { date_from: dateFrom, date_to: dateTo, store_id: storeId, store_filter: storeFilter.displayName, prev_date_from: prevDateFrom, prev_date_to: prevDateTo },
    summary: {
      new_customers: newCustomers,
      identifiable_customers: identifiable,
      active_customers: active,
      repeat_customers: repeatCustomers,
      dormant_reactivated: dormantReactivated,
      vip_customers: vipCustomers,
      stored_value_visits: 0,
      churn_risk_customers: 0,
      active_net_increase: Math.max(0, active - prevActive),
      new_dormant_customers: newDormantCustomers,
      net_asset_growth: netAssetGrowth,
      customer_revenue: customerRevenue,
      new_revenue: Number(s.new_revenue || 0),
      repeat_revenue: Number(s.repeat_revenue || 0),
      vip_revenue: Number(s.vip_revenue || 0),
      reactivated_revenue: Number(s.reactivated_revenue || 0),
      other_revenue: Number(s.other_revenue || 0),
      new_identification_rate: identifiable > 0 ? newCustomers / identifiable : 0,
      new_repeat_rate: newCustomers > 0 ? repeatCustomers / newCustomers : 0,
      active_customer_ratio: identifiable > 0 ? active / identifiable : 0,
      dormant_reactivation_rate: identifiable > 0 ? dormantReactivated / identifiable : 0,
      vip_customer_ratio: identifiable > 0 ? vipCustomers / identifiable : 0,
      avg_identifiable_revenue: identifiable > 0 ? customerRevenue / identifiable : 0,
      avg_repeat_revenue: repeatCustomers > 0 ? Number(s.repeat_revenue || 0) / repeatCustomers : 0,
    },
    previous_period: {
      date_from: prevDateFrom,
      date_to: prevDateTo,
      new_customers: Number(ps.new_customers || 0),
      identifiable_customers: Number(ps.identifiable_customers || 0),
      active_customers: prevActive,
      repeat_customers: Number(ps.repeat_customers || 0),
      dormant_reactivated: Number(ps.dormant_reactivated || 0),
      vip_customers: Number(ps.vip_customers || 0),
      customer_revenue: Number(ps.customer_revenue || 0),
    },
    comparison: {
      new_customers: pctChange(newCustomers, ps.new_customers),
      active_customers: pctChange(active, ps.active_customers),
      repeat_customers: pctChange(repeatCustomers, ps.repeat_customers),
      dormant_reactivated: pctChange(dormantReactivated, ps.dormant_reactivated),
      vip_customers: pctChange(vipCustomers, ps.vip_customers),
      customer_revenue: pctChange(customerRevenue, ps.customer_revenue),
    },
    stages: [
      { name: '新增客户', count: newCustomers, conversion_label: '二次复购转化率', conversion_rate: newCustomers > 0 ? repeatCustomers / newCustomers : 0 },
      { name: '二次复购', count: repeatCustomers, conversion_label: '活跃转化率', conversion_rate: repeatCustomers > 0 ? active / repeatCustomers : null },
      { name: '活跃客户', count: active, conversion_label: '高价值转化率', conversion_rate: active > 0 ? vipCustomers / active : 0 },
      { name: '高价值客户', count: vipCustomers, conversion_label: 'VIP待转化', conversion_rate: null },
      { name: '沉睡唤醒', count: dormantReactivated, conversion_label: '重新活跃客户', conversion_rate: identifiable > 0 ? dormantReactivated / identifiable : 0 },
    ],
    value_segments: [
      { name: '高价值客户', customers: Number(s.vip_primary_customers || 0), revenue: Number(s.vip_revenue || 0), rule: '优先口径：高消费或高频客户', action: '建立店长一对一维护池' },
      { name: '沉睡唤醒客户', customers: Number(s.reactivated_primary_customers || 0), revenue: Number(s.reactivated_revenue || 0), rule: '优先口径：历史60天以上未消费，本期回店', action: '进入连续维护，不只召回一次' },
      { name: '复购客户', customers: Number(s.repeat_primary_customers || 0), revenue: Number(s.repeat_revenue || 0), rule: '优先口径：本期消费2次及以上', action: '推送储值或会员权益' },
      { name: '新增客户', customers: Number(s.new_primary_customers || 0), revenue: Number(s.new_revenue || 0), rule: '优先口径：本期首次识别', action: '7-14天内做二次复购' },
      { name: '其他可识别客户', customers: Number(s.other_primary_customers || 0), revenue: Number(s.other_revenue || 0), rule: '用于让客户贡献营业额闭合', action: '继续沉淀标签和消费偏好' },
    ],
    insight_cards: [
      { priority: 'P1', label: '风险', title: '活跃与贡献较上期下降', text: '老客维护和高价值客户回访要优先执行。' },
      { priority: 'P1', label: '机会', title: '新客识别率较高', text: '可把首次消费后7-14天未回店客户放入二次复购池。' },
      { priority: 'P2', label: '重点', title: '高价值客户需要单独维护', text: '高价值客户占比低时，应建立VIP和店长一对一维护池。' },
    ],
    next_month_pools: [
      { name: '新客二次复购池', customers: newCustomers, channel: '短信 + 企微提醒', benefit: '二次复购券', action: '对首次消费后7-14天未回店的新客发送二次复购短信，店长同步企微跟进。', owner: '店长/客户运营', deadline: '7天内', target: '7天后看回店率和实收金额' },
      { name: '高价值客户池', customers: vipCustomers, channel: '店长一对一维护', benefit: '专属邀约/储值权益', action: '建立店长一对一维护池，优先邀约高消费或高频客户。', owner: '店长', deadline: '本月内', target: '提升复购和储值转化' },
      { name: '沉睡唤醒池', customers: dormantReactivated, channel: '连续触达两轮', benefit: '回店权益', action: '对沉睡唤醒客户连续触达两轮，复盘权益强度。', owner: '客户运营', deadline: '14天内', target: '重新激活并进入活跃池' },
      { name: '储值提醒池', customers: 0, channel: '余额提醒 + 菜品推荐', benefit: '余额消耗提醒', action: '提醒有余额但近期未消费客户回店消费。', owner: '店长/收银主管', deadline: '本月内', target: '消耗余额并带动复购' },
    ],
    action_entries: [
      { action: '生成下月客户维护计划', target: '四类重点客户池', owner: '客户运营', deadline: '本周内', expected_result: '形成可执行触达节奏和复盘目标' },
      { action: '生成短信/企微触达名单', target: '新客二次复购池、沉睡唤醒池', owner: '客户运营', deadline: '3天内', expected_result: '完成第一轮触达并记录触达结果' },
      { action: '生成店长跟进任务', target: '高价值客户池', owner: '店长', deadline: '7天内', expected_result: '完成一对一维护并复盘回店金额' },
      { action: '导出重点客户清单', target: '可识别客户与高价值客户', owner: '运营负责人', deadline: '今天', expected_result: '给门店形成可落地名单' },
    ],
    recommendations: [
      '把新客二次复购作为下月核心动作，重点跟踪首次消费后7-14天回店。',
      '对高价值客户建立单独维护池，避免只用普通群发触达。',
      '沉睡唤醒客户要进入连续维护，不要只做一次召回。'
    ],
    methodology: [
      '按统计周期内收银订单的手机号/会员ID识别客户资产。',
      '客户资产净增长 = 新增可识别客户 + 沉睡唤醒客户 + 活跃客户净增加 - 新增沉睡客户。',
      '客户价值默认采用去重口径：高价值客户 > 沉睡唤醒客户 > 复购客户 > 新增客户 > 其他可识别客户，避免金额重复计算。',
      '活跃客户按最近30天有消费统计；沉睡唤醒按历史超过60天未消费、本期重新消费统计。',
      '上期对比采用同等长度的上一周期。'
    ]
  }};
}

async function buildOpsRectificationReport(pool, tenantId, opts = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dateFrom = cleanText(opts.dateFrom || (today.slice(0, 8) + '01'), 20);
  const dateTo = cleanText(opts.dateTo || today, 20);
  const storeId = cleanText(opts.storeId || '', 80);
  const storeFilter = await resolveCustomerOpsStoreFilter(pool, tenantId, storeId);
  const params = [dateFrom, dateTo, storeId, storeFilter.posStoreNames, storeFilter.posStorePatterns, storeFilter.posStoreIds];
  const anomalyStoreSql = `($3::text='' OR store=$3 OR store=ANY($4::text[]) OR store=ANY($6::text[]) OR store ILIKE ANY($5::text[]))`;
  const anomaly = (await safeReportQuery(pool, `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE severity IN ('high','critical'))::int AS high_risk,
           COUNT(*) FILTER (WHERE status NOT IN ('closed','resolved'))::int AS open_count,
           COUNT(*) FILTER (WHERE task_id IS NOT NULL AND task_id <> '')::int AS generated_tasks
    FROM anomaly_triggers
    WHERE trigger_date >= $1::date AND trigger_date <= $2::date AND ${anomalyStoreSql}`, params, [{}]))[0] || {};
  const tasks = (await safeReportQuery(pool, `
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status IN ('done','closed','completed'))::int AS completed,
           COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND status NOT IN ('done','closed','completed') AND sla_due_at < NOW())::int AS overdue
    FROM master_tasks
    WHERE created_at::date >= $1::date AND created_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const rows = await safeReportQuery(pool, `
    SELECT anomaly_key, store, severity, status, trigger_date, task_id, resolution_code
    FROM anomaly_triggers
    WHERE trigger_date >= $1::date AND trigger_date <= $2::date AND ${anomalyStoreSql}
    ORDER BY trigger_date DESC LIMIT 30`, params, []);
  const totalTasks = Number(tasks.total || anomaly.generated_tasks || 0);
  const coreTasks = Number(anomaly.generated_tasks || 0);
  const followupTasks = Math.max(0, totalTasks - coreTasks);
  const completed = Number(tasks.completed || 0);
  const labelMap = {
    dish_decline: '菜品销量下滑',
    table_visit_ratio: '桌访/来客率异常',
    bad_review_product: '出品差评增加',
    bad_review_service: '服务差评增加',
    recharge_zero: '储值新增为0',
    private_room: '包房消费异常',
    revenue_drop: '营业额下降',
    avg_check_drop: '客单价下降',
    gross_margin: '毛利异常',
  };
  const anomalyLabel = (key) => {
    const raw = cleanText(key || '', 120);
    if (labelMap[raw]) return labelMap[raw];
    if (/private_room|包房/i.test(raw)) return '包房消费异常';
    if (/table|visit|客率|桌访/i.test(raw)) return '桌访/来客率异常';
    if (/dish|菜品|product/i.test(raw)) return '菜品销量下滑';
    if (/review|差评|service/i.test(raw)) return '口碑评价异常';
    if (/recharge|储值/i.test(raw)) return '储值新增异常';
    if (/revenue|营业额/i.test(raw)) return '营业额异常';
    return raw ? '经营异常' : '经营异常';
  };
  const severityMap = { critical: 'P0 老板必须关注', high: 'P1 店长当天处理', medium: 'P2 主管本周处理', low: 'P3 持续观察' };
  const statusMap = { open: '待响应', assigned: '已派发', processing: '处理中', done: '已完成', completed: '已完成', closed: '已复盘', resolved: '已改善' };
  const normalizedRows = rows.map((r) => ({
    type: anomalyLabel(r.anomaly_key),
    raw_type: r.anomaly_key || '',
    description: `${anomalyLabel(r.anomaly_key)}需要复盘`,
    impact_metric: anomalyLabel(r.anomaly_key),
    impact_level: severityMap[r.severity] || r.severity || '-',
    store: r.store || '-',
    owner_role: r.assigned_role || '店长/责任主管',
    owner: r.assigned_to || r.assigned_role || '待分配',
    suggestion: r.resolution_code || '按系统建议生成整改动作并上传完成证据',
    task: r.task_id || '-',
    deadline: r.sla_due_at ? String(r.sla_due_at).slice(0, 16).replace('T', ' ') : '待设置',
    status: statusMap[r.status] || r.status || '待响应',
    evidence: r.evidence_url || '待上传',
    before: r.before_value ?? r.severity ?? '-',
    after: r.after_value ?? '待复盘',
    improvement_rate: r.improvement_rate ?? null,
    improvement: r.status === 'closed' || r.status === 'resolved' ? '已验证改善' : '待验证改善',
  }));
  const groupCounts = normalizedRows.reduce((acc, r) => {
    const key = r.raw_type?.includes('review') ? '口碑类异常'
      : r.raw_type?.includes('dish') ? '菜品类异常'
      : r.raw_type?.includes('recharge') ? '客户类异常'
      : r.raw_type?.includes('revenue') || r.raw_type?.includes('table') || r.raw_type?.includes('avg') ? '营收类异常'
      : '执行类异常';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const dedupedProblems = [];
  for (const r of normalizedRows) {
    if (!dedupedProblems.find((x) => x.type === r.type)) dedupedProblems.push(r);
    if (dedupedProblems.length >= 3) break;
  }
  const topProblems = dedupedProblems.map((r) => ({
    title: r.type,
    impact: r.raw_type === 'recharge_zero' ? '客户资金沉淀不足' : r.raw_type?.includes('review') ? '复购和口碑风险' : r.raw_type?.includes('dish') ? '产品销售能力或推荐动作不足' : '门店经营指标波动',
    suggestion: r.raw_type === 'recharge_zero' ? '本周重点推动储值权益和老客回访' : r.raw_type?.includes('review') ? '店长完成服务/出品流程复训' : r.raw_type?.includes('dish') ? '复盘推荐话术和菜单曝光' : '责任人当天确认并提交整改动作',
  }));
  return { ok: true, report: {
    title: 'AI经营异常整改追踪报表',
    executive_summary: Number(anomaly.total || 0) > 0
      ? '本期系统发现多项经营异常，当前重点是推动责任人完成整改闭环并上传证据。'
      : '本期暂未发现需要重点追踪的经营异常，建议继续保持日常巡检。',
    period: { date_from: dateFrom, date_to: dateTo, store_id: storeId, store_filter: storeFilter.displayName },
    attribution_level: 'L2 改善归因',
    summary: {
      anomalies: Number(anomaly.total || 0),
      high_risk_anomalies: Number(anomaly.high_risk || 0),
      generated_tasks: totalTasks,
      core_rectification_tasks: coreTasks,
      followup_tasks: followupTasks,
      avg_tasks_per_anomaly: Number(anomaly.total || 0) > 0 ? totalTasks / Number(anomaly.total || 0) : 0,
      responded_tasks: totalTasks - Number(anomaly.open_count || 0),
      completed_tasks: completed,
      completion_rate: totalTasks > 0 ? completed / totalTasks : 0,
      overdue_tasks: Number(tasks.overdue || 0),
      unresolved_anomalies: Number(anomaly.open_count || 0),
      improved_metrics: completed,
      improvement_pass_rate: completed > 0 ? completed / Math.max(1, totalTasks) : 0,
      avg_response_hours: null,
      estimated_revenue_impact: 0,
    },
    funnel: [
      { name: '发现异常', value: Number(anomaly.total || 0), note: '系统识别出经营波动' },
      { name: '高风险异常', value: Number(anomaly.high_risk || 0), note: '需要老板或店长优先关注' },
      { name: '已生成任务', value: totalTasks, note: '系统已形成任务池' },
      { name: '已派发任务', value: null, note: '待接入任务派发数据' },
      { name: '已确认响应', value: Math.max(0, totalTasks - Number(anomaly.open_count || 0)), note: '责任人已收到或开始处理' },
      { name: '待上传证据', value: null, note: '待接入证据上传数据' },
      { name: '待复盘验证', value: Math.max(0, Number(anomaly.open_count || 0)), note: '需要查看整改后指标' },
      { name: '已验证改善', value: completed, note: '系统确认指标改善' },
    ],
    task_definitions: [
      '核心整改任务：必须由责任人完成，并上传整改证据的关键任务。',
      '辅助跟进任务：用于提醒、观察、复盘或协助处理的跟进动作。'
    ],
    anomaly_groups: Object.entries(groupCounts).map(([name, count]) => ({ name, count })),
    top_problems: topProblems,
    case_cards: normalizedRows.slice(0, 3),
    rows: normalizedRows,
    action_entries: [
      { action: '责任人确认异常原因', target: '高风险异常门店', owner: '店长/责任主管', deadline: '24小时内', expected_result: '确认原因并生成第一轮整改动作' },
      { action: '上传整改证据', target: '已派发整改任务', owner: '任务责任人', deadline: '3天内', expected_result: '形成可复盘证据链' },
      { action: '复盘整改后指标', target: '待复盘异常', owner: '运营负责人', deadline: '7天后', expected_result: '判断是否已验证改善' },
    ],
    recommendations: ['先跑通3-5个真实闭环案例，再把这张表用于对外销售。', '高风险异常需要老板日清，不建议只留在报表里。', '超期任务要进入店长排名，形成执行压力。', '整改后必须回看指标，否则不能证明经营闭环有效。'],
    methodology: ['L2改善归因：证明异常经过系统发现、派发、执行后指标是否改善。', '本报表不把整改动作直接等同于新增营业额，避免过度归因。', '只有完成证据、整改前后数值、复盘结论齐全时，才计入已验证改善。']
  }};
}

async function buildTalentGrowthReport(pool, tenantId, opts = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dateFrom = cleanText(opts.dateFrom || (today.slice(0, 8) + '01'), 20);
  const dateTo = cleanText(opts.dateTo || today, 20);
  const storeId = cleanText(opts.storeId || '', 80);
  const storeFilter = await resolveCustomerOpsStoreFilter(pool, tenantId, storeId);
  const train = (await safeReportQuery(pool, `
    SELECT COUNT(*)::int AS tasks,
           COUNT(DISTINCT employee_username)::int AS employees
    FROM training_assignments
    WHERE created_at::date >= $1::date AND created_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const sessions = (await safeReportQuery(pool, `
    SELECT COUNT(*)::int AS sessions,
           COUNT(*) FILTER (WHERE status IN ('completed','passed') OR quiz_passed=true)::int AS completed,
           COUNT(*) FILTER (WHERE quiz_passed=true)::int AS passed,
           COUNT(DISTINCT employee_username)::int AS learned_employees
    FROM training_sessions
    WHERE started_at::date >= $1::date AND started_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const cert = (await safeReportQuery(pool, `SELECT COUNT(*)::int AS certifications FROM training_certifications WHERE created_at::date >= $1::date AND created_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const scores = (await safeReportQuery(pool, `SELECT AVG(total_score)::numeric AS avg_score, COUNT(*)::int AS score_count FROM agent_scores WHERE created_at::date >= $1::date AND created_at::date <= $2::date`, [dateFrom, dateTo], [{}]))[0] || {};
  const tasks = Number(train.tasks || 0);
  const completed = Number(sessions.completed || 0);
  const passed = Number(sessions.passed || 0);
  const sessionCount = Number(sessions.sessions || 0);
  const certifications = Number(cert.certifications || 0);
  const avgScore = Number(scores.avg_score || 0);
  const promotionCandidates = certifications > 0 && avgScore >= 85 && sessionCount > 0 && (passed / Math.max(1, sessionCount)) >= 0.9 ? certifications : 0;
  const canStandInEmployees = null;
  const talentDataStatus = '“待接入”不是系统没跑完，而是当前还没有接入或没有形成对应数据，例如员工岗位绑定、主管确认、任务完成率、绩效、考勤和客诉。后续这些数据进入系统后，本表会自动显示具体人数、比例和岗位风险。';
  return { ok: true, report: {
    title: 'AI人才盘点与岗位认证报告',
    executive_summary: '当前已沉淀岗位认证数据，但培训、考试、绩效尚未完全打通，建议先作为岗位能力盘点使用。',
    period: { date_from: dateFrom, date_to: dateTo, store_id: storeId, store_filter: storeFilter.displayName },
    attribution_level: 'L3 影响归因',
    data_status: talentDataStatus,
    role_health_summary: '当前岗位数据尚未完整接入，建议优先补齐前厅服务员、烧鹅档、店长三个关键岗位的在岗与认证关系。数据完整后，这里会自动判断最大岗位风险、最稳定岗位和优先培养对象。',
    promotion_blocker: '当前卡点：绩效、任务完成率、考勤、客诉和主管评价尚未完整接入，因此晋升候选只做规则说明，不直接给出候选名单。',
    stand_in_rule: '可顶岗员工 = 岗位认证通过 + 主管确认 + 近30天无重大异常；仅完成岗位认证不等于可以顶岗。',
    summary: {
      training_tasks: tasks,
      participating_employees: Math.max(Number(train.employees || 0), Number(sessions.learned_employees || 0)),
      completion_rate: tasks > 0 ? completed / tasks : 0,
      exam_pass_rate: sessionCount > 0 ? passed / sessionCount : 0,
      certifications,
      avg_performance_score: avgScore,
      high_potential_employees: avgScore >= 85 ? Number(scores.score_count || 0) : 0,
      promotion_candidates: promotionCandidates,
      certification_only_employees: certifications,
      can_stand_in_employees: canStandInEmployees,
      coaching_needed_employees: sessionCount > 0 ? Math.max(0, sessionCount - passed) : 0,
      enabled_metrics: certifications,
    },
    enabled_metrics: [
      { label: '已认证员工', value: certifications, note: '完成岗位认证，不等于可顶岗' },
      { label: '认证岗位数', value: certifications > 0 ? 1 : 0, note: '按当前已接入认证记录统计' },
      { label: '可顶岗员工', value: canStandInEmployees, status: '待确认', note: '需主管确认和近30天无重大异常' },
      { label: '认证覆盖率', value: null, status: '待接入', note: '需岗位在岗人数' },
    ],
    pending_metrics: [
      { label: '培训任务', status: tasks > 0 ? '已启用' : '待启用' },
      { label: '考试通过率', status: sessionCount > 0 ? '已启用' : '待启用' },
      { label: '绩效关联', status: avgScore > 0 ? '已接入' : '待接入' },
      { label: '晋升候选', status: promotionCandidates > 0 ? '已筛选' : '待规则筛选' },
    ],
    role_rows: [
      { role: '前厅服务员', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '迎宾', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '收银', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '烧鹅档', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '炒锅', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
      { role: '店长', on_duty: null, certified: null, stand_in: null, coverage: null, backup: null, gap: null, risk: '待接入', reserve: '待接入员工岗位数据' },
    ],
    promotion_path: ['岗位认证通过', '绩效分达标', '任务完成率达标', '近30天无重大违规/客诉', '主管评价合格', '连续稳定周期达标', '进入晋升候选池'],
    enable_sequence: [
      { step: '先补齐岗位与员工绑定', target: '岗位/员工基础数据', owner: 'HR/店长', deadline: '本周内', expected_result: '岗位盘点表从待接入变成可统计' },
      { step: '选1个岗位试跑：前厅服务员', target: '前厅服务员岗位', owner: '培训负责人', deadline: '3天内', expected_result: '明确试点员工和训练目标' },
      { step: '选1个培训主题：招牌菜推荐话术', target: '招牌菜推荐话术', owner: '培训负责人', deadline: '7天内', expected_result: '完成培训内容、考试题和任务标准' },
      { step: '选10名员工参与试点', target: '前厅服务员10人', owner: '店长/培训负责人', deadline: '7天内', expected_result: '形成可观察的学习和执行样本' },
      { step: '14天后复盘结果', target: '考试/任务/推荐菜销量', owner: '运营/HR', deadline: '14天后', expected_result: '看考试通过率、任务完成率、推荐菜销量变化' },
    ],
    action_entries: [
      { action: '补齐岗位与员工绑定', target: '全部门店岗位', owner: 'HR/店长', deadline: '本周内', expected_result: '看清岗位缺口和可顶岗人员' },
      { action: '试跑一个岗位培训闭环', target: '优先选择前厅服务员或烧鹅档', owner: '培训负责人', deadline: '7天内', expected_result: '验证学习、考试、认证流程' },
      { action: '建立晋升候选规则', target: '已认证员工', owner: 'HR负责人', deadline: '本月内', expected_result: '输出可解释的后备主管/店长名单' },
    ],
    rows: [
      { item: '学习完成', metric: '完成率', value: tasks > 0 ? completed / tasks : null, conclusion: tasks > 0 ? '看员工是否按时完成学习' : '本期暂无培训任务数据' },
      { item: '考试掌握', metric: '通过率', value: sessionCount > 0 ? passed / sessionCount : null, conclusion: sessionCount > 0 ? '看知识是否被掌握' : '本期暂无考试过程数据' },
      { item: '岗位认证', metric: '认证人数', value: certifications, conclusion: '证明员工已完成某类岗位技能认证' },
      { item: '执行表现', metric: '平均绩效分', value: avgScore > 0 ? avgScore : null, conclusion: avgScore > 0 ? '看认证后执行稳定性' : '绩效分尚未与培训认证完整关联' },
      { item: '人才梯队', metric: '晋升候选', value: promotionCandidates, conclusion: '晋升候选需同时满足认证、绩效、任务完成率和无重大违规' },
    ],
    recommendations: ['先把本报表定位为内部岗位认证和人才池管理表，暂不作为销售主证据。', '从一个岗位、一个培训主题、10名员工、一轮14天复盘开始跑闭环。', '服务话术和招牌菜推荐培训要关联销售结果复盘。', '晋升候选必须叠加绩效、任务完成率、考勤、客诉和主管评价，不能等同于岗位认证。'],
    methodology: ['L3影响归因：展示培训、认证、执行、绩效之间的相关变化。', '已认证员工只代表岗位认证完成；可顶岗员工必须满足认证通过、主管确认、近30天无重大异常。', '待接入表示对应业务数据尚未进入系统或尚未形成可统计结果；数据完整后会自动显示具体数值。', '不直接声明培训创造营业额，而是证明员工能力和执行结果正在改善。']
  }};
}

async function generateDiagnosisNarrative(report, callLLM) {
  const b = report.business || {};
  const mix = report.customer_mix || {};
  const lifecycle = mix.lifecycle || {};
  const total = Math.max(b.customers || 1, 1);
  const dormantPct = Math.round((lifecycle.dormant || 0) / total * 100);
  const oneTimePct = Math.round((lifecycle.one_time || 0) / total * 100);
  const repeatRate = Math.round((b.customer_repeat_rate || 0) * 100);
  const lunchRevPct = Math.round((b.daypart?.lunch?.revenue || 0) / Math.max(b.revenue || 1, 1) * 100);
  const dinnerRevPct = Math.round((b.daypart?.dinner?.revenue || 0) / Math.max(b.revenue || 1, 1) * 100);
  const weekendOrders = b.weekday?.weekend?.orders || 0;
  const weekdayOrders = b.weekday?.weekday?.orders || 0;

  const prompt = `你是一位有15年经验的餐饮行业经营顾问。以下是${report.store_name}的POS数据分析结果，请生成专业的诊断报告文字内容，语气专业但老板能看懂，每条发现必须有具体数字支撑。

经营数据：
- 分析周期：${report.input_quality?.date_start || '-'} 至 ${report.input_quality?.date_end || '-'}
- 总营业额：¥${(b.revenue || 0).toLocaleString()}，日均营业额：¥${Math.round((b.revenue || 0) / Math.max(1, (() => { try { const d1 = new Date(report.input_quality?.date_start); const d2 = new Date(report.input_quality?.date_end); return Math.max(1, Math.round((d2 - d1) / 86400000)); } catch { return 30; } })())).toLocaleString()}
- 总客户数：${b.customers}人 | 复购客户占比：${repeatRate}% | 平均客单：¥${b.avg_check}
- 客群结构：常来客${lifecycle.regular || 0}人 / 偶尔来${lifecycle.occasional || 0}人 / 首次来${lifecycle.one_time || 0}人(${oneTimePct}%) / 沉睡客${lifecycle.dormant || 0}人(${dormantPct}%)
- 餐次分布：午市营业额占${lunchRevPct}% / 晚市营业额占${dinnerRevPct}%
- 周期分布：工作日${weekdayOrders}单 / 周末${weekendOrders}单
- 储值客：${b.stored_value?.customers || 0}人，在手余额：¥${(b.stored_value?.balance || 0).toLocaleString()}
- 客流稳定性评分：${b.revenue_stability_score}/100

请直接输出JSON，不要有其他文字：
{
  "executive_summary": "2-3句话，指出最突出的亮点和最紧迫的问题",
  "findings": [
    {"title": "发现标题（10字内）", "data": "具体数据说明", "assessment": "问题定性和对生意的影响（30-50字）"},
    {"title": "...", "data": "...", "assessment": "..."},
    {"title": "...", "data": "...", "assessment": "..."}
  ],
  "recommendations": [
    {"action": "具体可执行的建议（20字内）", "expected_result": "预期效果（20字内）"},
    {"action": "...", "expected_result": "..."},
    {"action": "...", "expected_result": "..."}
  ]
}`;

  try {
    const result = await callLLM([{ role: 'user', content: prompt }], { purpose: 'reasoning', max_tokens: 1200, temperature: 0.3 });
    if (!result.ok) return null;
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function mergeDiagnostics(parts) {
  const merged = { files: [], sheets: [], missing_required: [], warnings: [], confidence_score: 0, record_types: {} };
  for (const d of parts || []) {
    if (!d) continue;
    merged.files.push(d.source_file || '');
    merged.sheets.push(...(d.sheets || []));
    for (const w of d.warnings || []) if (!merged.warnings.includes(w)) merged.warnings.push(w);
    for (const [k, v] of Object.entries(d.record_types || {})) merged.record_types[k] = (merged.record_types[k] || 0) + Number(v || 0);
  }
  const present = merged.sheets.reduce((acc, s) => { for (const f of ['phone', 'bizDate', 'amount', 'dish', 'rechargeAmount', 'balance']) if (s.present?.[f]) acc[f] = true; return acc; }, {});
  merged.missing_required = ['phone', 'bizDate'].filter((f) => !present[f]).map((f) => FIELD_DEFS[f].label);
  if (!present.amount && !present.rechargeAmount && !present.balance) merged.missing_required.push('消费/储值金额');
  if (!present.dish) merged.warnings.push('未识别到菜品字段，菜品偏好和新品匹配会较弱');
  if (!present.phone) merged.warnings.push('未识别到手机号字段，只能做匿名客户诊断，无法沉淀可触达客户');
  merged.confidence_score = Math.round((['phone', 'bizDate'].reduce((s, f) => s + (present[f] ? 25 : 0), 0)) + ((present.amount || present.rechargeAmount || present.balance) ? 25 : 0) + (present.dish ? 25 : 0));
  merged.files = merged.files.filter(Boolean);
  return merged;
}

function dedupeRecords(records) {
  const map = new Map();
  for (const r of records || []) { const key = r.recordKey || recordKeyOf(r); if (!key) continue; map.set(key, { ...r, recordKey: key }); }
  return Array.from(map.values());
}

async function loadExistingSourceRecords(pool, tenantId) {
  const r = await pool.query(`SELECT record_json FROM customer_ops_source_records WHERE tenant_id=$1 ORDER BY id ASC LIMIT 120000`, [tenantId]);
  return (r.rows || []).map((x) => x.record_json || {});
}

// 模块2：根据criteria_json过滤客户
function applySegmentCriteria(profiles, criteria) {
  return profiles.filter((c) => {
    if (criteria.lifecycle_stage && c.lifecycle_stage !== criteria.lifecycle_stage) return false;
    if (criteria.value_tier && c.value_tier !== criteria.value_tier) return false;
    if (criteria.scene_tag && !(c.scene_tags || []).includes(criteria.scene_tag)) return false;
    if (criteria.min_order_count != null && c.order_count < Number(criteria.min_order_count)) return false;
    if (criteria.max_order_count != null && c.order_count > Number(criteria.max_order_count)) return false;
    if (criteria.min_orders_30d != null && (c.orders_30d || 0) < Number(criteria.min_orders_30d)) return false;
    if (criteria.max_days_since != null && c.days_since_last_visit > Number(criteria.max_days_since)) return false;
    if (criteria.min_days_since != null && c.days_since_last_visit < Number(criteria.min_days_since)) return false;
    if (criteria.min_avg_check != null && c.avg_check < Number(criteria.min_avg_check)) return false;
    if (criteria.max_avg_check != null && c.avg_check > Number(criteria.max_avg_check)) return false;
    if (criteria.min_total_spend != null && c.total_spend < Number(criteria.min_total_spend)) return false;
    if (criteria.min_spend_90d != null && (c.spend_90d || 0) < Number(criteria.min_spend_90d)) return false;
    if (criteria.min_max_single_spend != null && (c.max_single_spend || 0) < Number(criteria.min_max_single_spend)) return false;
    if (criteria.min_max_single_diners != null && (c.max_single_diners || 0) < Number(criteria.min_max_single_diners)) return false;
    if (criteria.min_stored_value_balance != null && c.stored_value_balance < Number(criteria.min_stored_value_balance)) return false;
    if (criteria.preferred_visit_time && c.preferred_visit_time !== criteria.preferred_visit_time) return false;
    if (criteria.primary_store && c.primary_store !== criteria.primary_store) return false;
    if (criteria.favorite_dish_keyword) {
      const kw = String(criteria.favorite_dish_keyword).toLowerCase();
      if (!(c.favorite_dishes || []).some((d) => String(d).toLowerCase().includes(kw))) return false;
    }
    return true;
  });
}

export function registerCustomerOpsRoutes(app, pool, authRequired, upload, uploadsDir, recordUploadOwnership, callLLM, opts = {}) {
  const basePath = opts.basePath || '/api/customer-ops';
  const getTenantId = opts.getTenantId || ((req) => req.tenantId || 'default');
  // ── 模块1：快速诊断 ──────────────────────────────────────────────

  app.post(`${basePath}/diagnosis/upload`, authRequired, upload.fields([{ name: 'files', maxCount: 20 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
    try {
      const files = [...(req.files?.files || []), ...(req.files?.file || [])].filter(Boolean);
      if (!files.length) return res.status(400).json({ ok: false, error: 'no_file' });
      await ensureCustomerOpsTables(pool);
      await recordUploadOwnership(files.map((f) => f.filename), getTenantId(req), req.user?.username);
      const tenantId = getTenantId(req);
      const parsed = files.map((file) => normalizeWorkbook(file.path, { sourceFile: file.originalname || file.filename }));
      const batchRecords = dedupeRecords(parsed.flatMap((x) => x.orders || []));
      const mergePrevious = String(req.body?.merge_previous ?? 'true') !== 'false';
      const existingRecords = mergePrevious ? await loadExistingSourceRecords(pool, tenantId) : [];
      const orders = dedupeRecords([...existingRecords, ...batchRecords]);
      const diagnostics = mergeDiagnostics(parsed.map((x) => x.diagnostics));
      diagnostics.batch_files = files.map((f) => f.originalname || f.filename);
      diagnostics.batch_records = batchRecords.length;
      diagnostics.historical_records = existingRecords.length;
      diagnostics.total_records_after_merge = orders.length;
      const report = analyzeOrders(orders, { storeName: req.body?.store_name || '', diagnostics });
      const ins = await pool.query(
        `INSERT INTO customer_ops_diagnoses (tenant_id, store_name, source_filename, report_json, created_by) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, created_at`,
        [tenantId, report.store_name, files.map((f) => f.originalname || f.filename).join('、'), JSON.stringify(report), req.user?.username || '']
      );
      const diagnosisId = ins.rows[0].id;
      for (const r of batchRecords) {
        await pool.query(
          `INSERT INTO customer_ops_source_records (tenant_id, diagnosis_id, source_filename, record_key, phone, member_no, record_kind, record_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (tenant_id, record_key) DO UPDATE SET diagnosis_id=EXCLUDED.diagnosis_id, source_filename=EXCLUDED.source_filename, phone=EXCLUDED.phone, member_no=EXCLUDED.member_no, record_kind=EXCLUDED.record_kind, record_json=EXCLUDED.record_json`,
          [tenantId, diagnosisId, r.sourceFile || '', r.recordKey || recordKeyOf(r), r.phone || '', r.memberNo || '', r.kind || 'unknown', JSON.stringify(r)]
        );
      }
      for (const c of report.customers) {
        await pool.query(
          `INSERT INTO customer_ops_profiles (tenant_id, diagnosis_id, customer_id, customer_key, phone, profile_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [tenantId, diagnosisId, c.customer_id, c.customer_key, c.phone || '', JSON.stringify(c)]
        );
      }
      res.json({ ok: true, diagnosis_id: diagnosisId, imported_records: batchRecords.length, merged_records: orders.length, report: { ...report, customers: undefined } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || 'diagnosis_failed' });
    }
  });

  app.get(`${basePath}/diagnosis/latest`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT id, store_name, source_filename, report_json, created_at FROM customer_ops_diagnoses WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`, [getTenantId(req)]);
      res.json({ ok: true, diagnosis: r.rows[0] || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get(`${basePath}/diagnosis/:id/pdf`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT * FROM customer_ops_diagnoses WHERE id = $1 AND tenant_id = $2`, [req.params.id, getTenantId(req)]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      const report = r.rows[0].report_json;
      // 生成AI诊断叙述（失败不阻塞PDF生成）
      const narrative = callLLM ? await generateDiagnosisNarrative(report, callLLM).catch(() => null) : null;
      const reportWithNarrative = narrative ? { ...report, narrative } : report;
      const filename = `customer_ops_report_${req.params.id}.pdf`;
      const outputPath = path.join(uploadsDir, filename);
      await runPdfGenerator(reportWithNarrative, outputPath);
      await recordUploadOwnership(filename, getTenantId(req), req.user?.username);
      res.json({ ok: true, url: `/uploads/${filename}` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || 'pdf_failed' });
    }
  });

  // ── 模块2：360度客人档案 ─────────────────────────────────────────

  app.get(`${basePath}/customers`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const diagnosisId = Number(req.query.diagnosis_id || 0);
      const limit = Math.min(500, Number(req.query.limit || 200));
      const params = [tenantId];
      let where = 'tenant_id = $1';
      if (diagnosisId) { params.push(diagnosisId); where += ` AND diagnosis_id = $${params.length}`; }
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE ${where} ORDER BY (profile_json->>'total_spend')::numeric DESC NULLS LAST LIMIT ${limit}`, params);
      res.json({ ok: true, customers: r.rows.map((x) => x.profile_json) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get(`${basePath}/customers/dashboard`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const diagnosisId = Number(req.query.diagnosis_id || 0);
      const params = [tenantId];
      let where = 'tenant_id = $1';
      if (diagnosisId) { params.push(diagnosisId); where += ` AND diagnosis_id = $${params.length}`; }
      // 只取最新一个diagnosis的所有profile
      if (!diagnosisId) {
        const latest = await pool.query(`SELECT id FROM customer_ops_diagnoses WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tenantId]);
        if (latest.rows.length) { params.push(latest.rows[0].id); where += ` AND diagnosis_id = $${params.length}`; }
      }
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE ${where}`, params);
      const profiles = r.rows.map((x) => x.profile_json || {});
      const total = profiles.length;
      const byLifecycle = {};
      const byValueTier = {};
      const byScene = {};
      let totalSpend = 0;
      let totalVip = 0;
      let totalDormant = 0;
      let totalWithPhone = 0;
      for (const c of profiles) {
        byLifecycle[c.lifecycle_stage] = (byLifecycle[c.lifecycle_stage] || 0) + 1;
        byValueTier[c.value_tier] = (byValueTier[c.value_tier] || 0) + 1;
        for (const tag of c.scene_tags || []) byScene[tag] = (byScene[tag] || 0) + 1;
        totalSpend += Number(c.total_spend || 0);
        if (c.value_tier === 'vip') totalVip++;
        if (c.lifecycle_stage === 'dormant') totalDormant++;
        if (c.phone) totalWithPhone++;
      }
      res.json({ ok: true, total, total_spend: Math.round(totalSpend), vip_count: totalVip, dormant_count: totalDormant, reachable_count: totalWithPhone, by_lifecycle: byLifecycle, by_value_tier: byValueTier, by_scene: byScene });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.post(`${basePath}/customers/filter`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const criteria = req.body?.criteria || {};
      const diagnosisId = Number(req.body?.diagnosis_id || 0);
      const params = [tenantId];
      let where = 'tenant_id = $1';
      if (diagnosisId) { params.push(diagnosisId); where += ` AND diagnosis_id = $${params.length}`; }
      else {
        const latest = await pool.query(`SELECT id FROM customer_ops_diagnoses WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tenantId]);
        if (latest.rows.length) { params.push(latest.rows[0].id); where += ` AND diagnosis_id = $${params.length}`; }
      }
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE ${where}`, params);
      const all = r.rows.map((x) => x.profile_json || {});
      const matched = applySegmentCriteria(all, criteria);
      res.json({ ok: true, total: all.length, matched: matched.length, customers: matched.slice(0, 200) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get(`${basePath}/customers/:customerId`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE tenant_id = $1 AND customer_id = $2 ORDER BY diagnosis_id DESC LIMIT 1`, [getTenantId(req), req.params.customerId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, customer: r.rows[0].profile_json });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 保存自定义客群分层
  app.get(`${basePath}/segments`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT * FROM customer_segments WHERE tenant_id=$1 ORDER BY created_at DESC`, [getTenantId(req)]);
      res.json({ ok: true, segments: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.post(`${basePath}/segments`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const name = cleanText(req.body?.name || '', 80);
      const criteria = req.body?.criteria || {};
      if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
      const r = await pool.query(`INSERT INTO customer_segments (tenant_id, name, criteria_json, created_by) VALUES ($1,$2,$3::jsonb,$4) RETURNING *`, [getTenantId(req), name, JSON.stringify(criteria), req.user?.username || '']);
      res.json({ ok: true, segment: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.delete(`${basePath}/segments/:id`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      await pool.query(`DELETE FROM customer_segments WHERE id=$1 AND tenant_id=$2`, [req.params.id, getTenantId(req)]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── 模块3：营销活动台账 ──────────────────────────────────────────

  app.get(`${basePath}/campaigns`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      await syncAutoCampaignsFromDeliveryLogs(pool, tenantId).catch((e) => console.warn('[customer-ops] auto campaign sync failed:', e?.message));
      const status = cleanText(req.query.status || '', 20);
      const dateFrom = cleanText(req.query.date_from || '', 20);
      const dateTo = cleanText(req.query.date_to || '', 20);
      const storeId = cleanText(req.query.store_id || '', 80);
      const params = [tenantId];
      let where = 'c.tenant_id=$1';
      if (status) { params.push(status); where += ` AND c.status=$${params.length}`; }
      if (dateFrom) { params.push(dateFrom); where += ` AND c.planned_date >= $${params.length}::date`; }
      if (dateTo) { params.push(dateTo); where += ` AND c.planned_date <= $${params.length}::date`; }
      if (storeId) { params.push(JSON.stringify([storeId])); where += ` AND (c.store_ids = '[]'::jsonb OR c.store_ids @> $${params.length}::jsonb)`; }
      const r = await pool.query(
        `SELECT c.*, COALESCE(json_agg(r ORDER BY r.created_at) FILTER (WHERE r.id IS NOT NULL), '[]') AS results
           FROM marketing_campaigns c
           LEFT JOIN marketing_campaign_results r ON r.campaign_id=c.id AND r.tenant_id=c.tenant_id
          WHERE ${where} GROUP BY c.id ORDER BY c.planned_date DESC NULLS LAST, c.created_at DESC LIMIT 200`,
        params
      );
      res.json({ ok: true, campaigns: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // PDF导出：指定时间/门店范围内的营销活动执行报告（供租户证明行动内容）
  app.get(`${basePath}/campaigns/report-pdf`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      await syncAutoCampaignsFromDeliveryLogs(pool, tenantId).catch(() => {});
      const dateFrom = cleanText(req.query.date_from || '', 20) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const dateTo = cleanText(req.query.date_to || '', 20) || new Date().toISOString().slice(0, 10);
      const storeId = cleanText(req.query.store_id || '', 80);
      const params = [tenantId, dateFrom, dateTo];
      let where = 'c.tenant_id=$1 AND c.planned_date >= $2::date AND c.planned_date <= $3::date';
      if (storeId) { params.push(JSON.stringify([storeId])); where += ` AND (c.store_ids = '[]'::jsonb OR c.store_ids @> $${params.length}::jsonb)`; }
      const r = await pool.query(
        `SELECT c.*, COALESCE(json_agg(r ORDER BY r.created_at) FILTER (WHERE r.id IS NOT NULL), '[]') AS results
           FROM marketing_campaigns c
           LEFT JOIN marketing_campaign_results r ON r.campaign_id=c.id AND r.tenant_id=c.tenant_id
          WHERE ${where} GROUP BY c.id ORDER BY c.planned_date ASC NULLS LAST, c.created_at ASC LIMIT 500`,
        params
      );
      const payload = {
        campaigns: r.rows,
        date_from: dateFrom,
        date_to: dateTo,
        store_filter: storeId || '全部门店',
        generated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      };
      const filename = `campaign_report_${tenantId}_${dateFrom}_${dateTo}.pdf`;
      const outputPath = path.join(uploadsDir, filename);
      await runCampaignReportPdfGenerator(payload, outputPath);
      await recordUploadOwnership(filename, tenantId, req.user?.username || req.platformAdmin?.username);
      res.json({ ok: true, url: `/uploads/${filename}` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || 'pdf_failed' });
    }
  });

  // AI客户增长归因报表：用触达日志匹配POS回店订单，证明系统维护动作带来的可归因营业额。
  app.get(`${basePath}/attribution-report`, authRequired, async (req, res) => {
    try {
      const report = await buildAttributionReport(pool, getTenantId(req), {
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        storeId: req.query.store_id,
        windowDays: req.query.window_days,
      });
      res.json(report);
    } catch (e) {
      console.error('[customer-ops] attribution report failed:', e);
      res.status(500).json({ ok: false, error: e?.message || 'attribution_report_failed' });
    }
  });

  app.get(`${basePath}/reports/customer-assets`, authRequired, async (req, res) => {
    try {
      const report = await buildCustomerAssetReport(pool, getTenantId(req), {
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        storeId: req.query.store_id || req.query.storeId,
      });
      await applyReportMetricFacts(pool, getTenantId(req), report.report, 'customer_assets', req.query.store_id || req.query.storeId);
      const enriched = enrichReportForBusinessOntology(report.report, buildCustomerAssetMetricsInput);
      enriched.previousActionReview = await reviewOntologyTaskHistory(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, reportType: 'customer_assets' }).catch(() => ({ resultReviewStatus: 'insufficient_data', tasksCreated: 0, tasksCompleted: 0, tasks: [], summary: '上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。' }));
      res.json({ ...report, report: enriched });
    } catch (e) {
      console.error('[customer-ops] customer asset report failed:', e);
      res.status(500).json({ ok: false, error: e?.message || 'customer_asset_report_failed' });
    }
  });

  app.get(`${basePath}/reports/ops-rectification`, authRequired, async (req, res) => {
    try {
      const report = await buildOpsRectificationReport(pool, getTenantId(req), {
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        storeId: req.query.store_id || req.query.storeId,
      });
      await applyReportMetricFacts(pool, getTenantId(req), report.report, 'ops_rectification', req.query.store_id || req.query.storeId);
      const enriched = enrichReportForBusinessOntology(report.report, buildOperationImprovementMetricsInput);
      enriched.previousActionReview = await reviewOntologyTaskHistory(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, reportType: 'ops_rectification' }).catch(() => ({ resultReviewStatus: 'insufficient_data', tasksCreated: 0, tasksCompleted: 0, tasks: [], summary: '上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。' }));
      res.json({ ...report, report: enriched });
    } catch (e) {
      console.error('[customer-ops] ops rectification report failed:', e);
      res.status(500).json({ ok: false, error: e?.message || 'ops_rectification_report_failed' });
    }
  });

  app.get(`${basePath}/reports/talent-growth`, authRequired, async (req, res) => {
    try {
      const report = await buildTalentGrowthReport(pool, getTenantId(req), {
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        storeId: req.query.store_id || req.query.storeId,
      });
      await applyReportMetricFacts(pool, getTenantId(req), report.report, 'talent_growth', req.query.store_id || req.query.storeId);
      const enriched = enrichReportForBusinessOntology(report.report, buildTalentDevelopmentMetricsInput);
      enriched.previousActionReview = await reviewOntologyTaskHistory(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, reportType: 'talent_growth' }).catch(() => ({ resultReviewStatus: 'insufficient_data', tasksCreated: 0, tasksCompleted: 0, tasks: [], summary: '上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。' }));
      res.json({ ...report, report: enriched });
    } catch (e) {
      console.error('[customer-ops] talent growth report failed:', e);
      res.status(500).json({ ok: false, error: e?.message || 'talent_growth_report_failed' });
    }
  });

  app.post(`${basePath}/campaigns`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const b = req.body || {};
      const title = cleanText(b.title || '', 200);
      if (!title) return res.status(400).json({ ok: false, error: 'title_required' });
      const r = await pool.query(
        `INSERT INTO marketing_campaigns (tenant_id, title, channel, campaign_type, status, planned_date, planned_end_date, store_ids, target_audience, target_count, content, goal, budget, reminder_date, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [tenantId, title, cleanText(b.channel || 'offline', 40), cleanText(b.campaign_type || '其他', 40), cleanText(b.status || 'planned', 20), b.planned_date || null, b.planned_end_date || null, JSON.stringify(b.store_ids || []), cleanText(b.target_audience || '', 500), Number(b.target_count || 0), cleanText(b.content || '', 2000), cleanText(b.goal || '', 500), Number(b.budget || 0), b.reminder_date || null, cleanText(b.source || 'manual', 40), req.user?.username || '']
      );
      res.json({ ok: true, campaign: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.put(`${basePath}/campaigns/:id`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const b = req.body || {};
      const r = await pool.query(
        `UPDATE marketing_campaigns SET title=$1, channel=$2, campaign_type=$3, status=$4, planned_date=$5, planned_end_date=$6, store_ids=$7::jsonb, target_audience=$8, target_count=$9, content=$10, goal=$11, budget=$12, reminder_date=$13, updated_at=NOW()
         WHERE id=$14 AND tenant_id=$15 RETURNING *`,
        [cleanText(b.title || '', 200), cleanText(b.channel || 'offline', 40), cleanText(b.campaign_type || '其他', 40), cleanText(b.status || 'planned', 20), b.planned_date || null, b.planned_end_date || null, JSON.stringify(b.store_ids || []), cleanText(b.target_audience || '', 500), Number(b.target_count || 0), cleanText(b.content || '', 2000), cleanText(b.goal || '', 500), Number(b.budget || 0), b.reminder_date || null, req.params.id, tenantId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, campaign: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.delete(`${basePath}/campaigns/:id`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      await pool.query(`DELETE FROM marketing_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, getTenantId(req)]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 门店复盘结果
  app.post(`${basePath}/campaigns/:id/results`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const b = req.body || {};
      const r = await pool.query(
        `INSERT INTO marketing_campaign_results (tenant_id, campaign_id, store_id, store_name, actual_send_count, actual_reach_count, actual_conversion_count, actual_revenue, actual_exposure_count, actual_redemption_count, actual_cost, effect_rating, result_note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [tenantId, req.params.id, cleanText(b.store_id || '', 80), cleanText(b.store_name || '', 120), Number(b.actual_send_count || 0), Number(b.actual_reach_count || 0), Number(b.actual_conversion_count || 0), Number(b.actual_revenue || 0), Number(b.actual_exposure_count || 0), Number(b.actual_redemption_count || 0), Number(b.actual_cost || 0), cleanText(b.effect_rating || '', 20), cleanText(b.result_note || '', 2000), req.user?.username || '']
      );
      const campaignRow = await pool.query(`SELECT * FROM marketing_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, tenantId]);
      await saveCampaignResultAsLearning(pool, tenantId, campaignRow.rows[0], r.rows[0]);
      res.json({ ok: true, result: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.put(`${basePath}/campaigns/:id/results/:resultId`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const b = req.body || {};
      const r = await pool.query(
        `UPDATE marketing_campaign_results SET store_id=$1, store_name=$2, actual_send_count=$3, actual_reach_count=$4, actual_conversion_count=$5, actual_revenue=$6, actual_exposure_count=$7, actual_redemption_count=$8, actual_cost=$9, effect_rating=$10, result_note=$11, updated_at=NOW()
         WHERE id=$12 AND campaign_id=$13 AND tenant_id=$14 RETURNING *`,
        [cleanText(b.store_id || '', 80), cleanText(b.store_name || '', 120), Number(b.actual_send_count || 0), Number(b.actual_reach_count || 0), Number(b.actual_conversion_count || 0), Number(b.actual_revenue || 0), Number(b.actual_exposure_count || 0), Number(b.actual_redemption_count || 0), Number(b.actual_cost || 0), cleanText(b.effect_rating || '', 20), cleanText(b.result_note || '', 2000), req.params.resultId, req.params.id, tenantId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      const campaignRow = await pool.query(`SELECT * FROM marketing_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, tenantId]);
      await saveCampaignResultAsLearning(pool, tenantId, campaignRow.rows[0], r.rows[0]);
      res.json({ ok: true, result: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 自动营销发送汇总（从现有delivery_logs聚合）
  app.get(`${basePath}/auto-marketing-summary`, authRequired, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const dateFrom = cleanText(req.query.date_from || '', 20) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const dateTo = cleanText(req.query.date_to || '', 20) || new Date().toISOString().slice(0, 10);
      // 尝试从 growth_delivery_logs 聚合（表可能不存在，失败返回空）
      const r = await pool.query(
        `SELECT dl.rule_key, tr.name AS rule_name, COUNT(*) AS send_count, COUNT(DISTINCT dl.phone) AS unique_phones,
                MAX(dl.created_at)::date AS last_sent_date,
                MAX(dl.message_text) AS sample_message
           FROM growth_delivery_logs dl
           LEFT JOIN growth_touch_rules tr ON tr.rule_key = dl.rule_key AND tr.tenant_id = dl.tenant_id
          WHERE dl.tenant_id = $1 AND dl.status = 'sent'
            AND dl.created_at >= $2::date AND dl.created_at < ($3::date + INTERVAL '1 day')
          GROUP BY dl.rule_key, tr.name
          ORDER BY send_count DESC LIMIT 50`,
        [tenantId, dateFrom, dateTo]
      ).catch(() => ({ rows: [] }));
      res.json({ ok: true, date_from: dateFrom, date_to: dateTo, rules: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });
}

export { ensureCustomerOpsTables, analyzeOrders, normalizeWorkbook };
