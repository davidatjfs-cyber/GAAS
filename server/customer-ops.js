import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import XLSX from 'xlsx';

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

export function registerCustomerOpsRoutes(app, pool, authRequired, upload, uploadsDir, recordUploadOwnership, callLLM) {
  // ── 模块1：快速诊断 ──────────────────────────────────────────────

  app.post('/api/customer-ops/diagnosis/upload', authRequired, upload.fields([{ name: 'files', maxCount: 20 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
    try {
      const files = [...(req.files?.files || []), ...(req.files?.file || [])].filter(Boolean);
      if (!files.length) return res.status(400).json({ ok: false, error: 'no_file' });
      await ensureCustomerOpsTables(pool);
      await recordUploadOwnership(files.map((f) => f.filename), req.tenantId, req.user?.username);
      const tenantId = req.tenantId || 'default';
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

  app.get('/api/customer-ops/diagnosis/latest', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT id, store_name, source_filename, report_json, created_at FROM customer_ops_diagnoses WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`, [req.tenantId || 'default']);
      res.json({ ok: true, diagnosis: r.rows[0] || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get('/api/customer-ops/diagnosis/:id/pdf', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT * FROM customer_ops_diagnoses WHERE id = $1 AND tenant_id = $2`, [req.params.id, req.tenantId || 'default']);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      const report = r.rows[0].report_json;
      // 生成AI诊断叙述（失败不阻塞PDF生成）
      const narrative = callLLM ? await generateDiagnosisNarrative(report, callLLM).catch(() => null) : null;
      const reportWithNarrative = narrative ? { ...report, narrative } : report;
      const filename = `customer_ops_report_${req.params.id}.pdf`;
      const outputPath = path.join(uploadsDir, filename);
      await runPdfGenerator(reportWithNarrative, outputPath);
      await recordUploadOwnership(filename, req.tenantId, req.user?.username);
      res.json({ ok: true, url: `/uploads/${filename}` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || 'pdf_failed' });
    }
  });

  // ── 模块2：360度客人档案 ─────────────────────────────────────────

  app.get('/api/customer-ops/customers', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = req.tenantId || 'default';
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

  app.get('/api/customer-ops/customers/dashboard', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = req.tenantId || 'default';
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

  app.post('/api/customer-ops/customers/filter', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = req.tenantId || 'default';
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

  app.get('/api/customer-ops/customers/:customerId', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE tenant_id = $1 AND customer_id = $2 ORDER BY diagnosis_id DESC LIMIT 1`, [req.tenantId || 'default', req.params.customerId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, customer: r.rows[0].profile_json });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 保存自定义客群分层
  app.get('/api/customer-ops/segments', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT * FROM customer_segments WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.tenantId || 'default']);
      res.json({ ok: true, segments: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.post('/api/customer-ops/segments', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const name = cleanText(req.body?.name || '', 80);
      const criteria = req.body?.criteria || {};
      if (!name) return res.status(400).json({ ok: false, error: 'name_required' });
      const r = await pool.query(`INSERT INTO customer_segments (tenant_id, name, criteria_json, created_by) VALUES ($1,$2,$3::jsonb,$4) RETURNING *`, [req.tenantId || 'default', name, JSON.stringify(criteria), req.user?.username || '']);
      res.json({ ok: true, segment: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.delete('/api/customer-ops/segments/:id', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      await pool.query(`DELETE FROM customer_segments WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId || 'default']);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // ── 模块3：营销活动台账 ──────────────────────────────────────────

  app.get('/api/customer-ops/campaigns', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = req.tenantId || 'default';
      const status = cleanText(req.query.status || '', 20);
      const params = [tenantId];
      let where = 'c.tenant_id=$1';
      if (status) { params.push(status); where += ` AND c.status=$${params.length}`; }
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

  app.post('/api/customer-ops/campaigns', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = req.tenantId || 'default';
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

  app.put('/api/customer-ops/campaigns/:id', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = req.tenantId || 'default';
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

  app.delete('/api/customer-ops/campaigns/:id', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      await pool.query(`DELETE FROM marketing_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, req.tenantId || 'default']);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 门店复盘结果
  app.post('/api/customer-ops/campaigns/:id/results', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = req.tenantId || 'default';
      const b = req.body || {};
      const r = await pool.query(
        `INSERT INTO marketing_campaign_results (tenant_id, campaign_id, store_id, store_name, actual_send_count, actual_reach_count, actual_conversion_count, actual_revenue, actual_exposure_count, actual_redemption_count, actual_cost, effect_rating, result_note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [tenantId, req.params.id, cleanText(b.store_id || '', 80), cleanText(b.store_name || '', 120), Number(b.actual_send_count || 0), Number(b.actual_reach_count || 0), Number(b.actual_conversion_count || 0), Number(b.actual_revenue || 0), Number(b.actual_exposure_count || 0), Number(b.actual_redemption_count || 0), Number(b.actual_cost || 0), cleanText(b.effect_rating || '', 20), cleanText(b.result_note || '', 2000), req.user?.username || '']
      );
      res.json({ ok: true, result: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.put('/api/customer-ops/campaigns/:id/results/:resultId', authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = req.tenantId || 'default';
      const b = req.body || {};
      const r = await pool.query(
        `UPDATE marketing_campaign_results SET store_id=$1, store_name=$2, actual_send_count=$3, actual_reach_count=$4, actual_conversion_count=$5, actual_revenue=$6, actual_exposure_count=$7, actual_redemption_count=$8, actual_cost=$9, effect_rating=$10, result_note=$11, updated_at=NOW()
         WHERE id=$12 AND campaign_id=$13 AND tenant_id=$14 RETURNING *`,
        [cleanText(b.store_id || '', 80), cleanText(b.store_name || '', 120), Number(b.actual_send_count || 0), Number(b.actual_reach_count || 0), Number(b.actual_conversion_count || 0), Number(b.actual_revenue || 0), Number(b.actual_exposure_count || 0), Number(b.actual_redemption_count || 0), Number(b.actual_cost || 0), cleanText(b.effect_rating || '', 20), cleanText(b.result_note || '', 2000), req.params.resultId, req.params.id, tenantId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, result: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 自动营销发送汇总（从现有delivery_logs聚合）
  app.get('/api/customer-ops/auto-marketing-summary', authRequired, async (req, res) => {
    try {
      const tenantId = req.tenantId || 'default';
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
