import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'inventory-forecast', handler: 'pdf-parse' });

export function decodePdfLiteralText(token) {
  let s = String(token || '');
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => {
      const code = parseInt(oct, 8);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    });
}

export function decodeUtf16BeBuffer(buf) {
  const src = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  if (!src.length) return '';
  const len = src.length - (src.length % 2);
  if (len <= 0) return '';
  const swapped = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i += 2) {
    swapped[i] = src[i + 1];
    swapped[i + 1] = src[i];
  }
  return swapped.toString('utf16le');
}

export function decodePdfHexToken(hexRaw) {
  const hex = String(hexRaw || '').replace(/\s+/g, '');
  if (!hex || hex.length % 2 !== 0) return '';
  let bytes;
  try {
    bytes = Buffer.from(hex, 'hex');
  } catch (e) {
    return '';
  }
  if (!bytes.length) return '';

  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return decodeUtf16BeBuffer(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return bytes.subarray(2).toString('utf16le');
  }

  let evenZero = 0;
  let oddZero = 0;
  const pairs = Math.floor(bytes.length / 2);
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    if (bytes[i] === 0) evenZero += 1;
    if (bytes[i + 1] === 0) oddZero += 1;
  }
  if (pairs > 2) {
    const evenZeroRate = evenZero / pairs;
    const oddZeroRate = oddZero / pairs;
    if (evenZeroRate > 0.45 && oddZeroRate < 0.2) {
      return decodeUtf16BeBuffer(bytes);
    }
    if (oddZeroRate > 0.45 && evenZeroRate < 0.2) {
      return bytes.toString('utf16le');
    }
  }

  const utf8 = bytes.toString('utf8');
  const bad = (utf8.match(/�/g) || []).length;
  if (bad <= Math.max(2, Math.floor(utf8.length * 0.1))) return utf8;
  return bytes.toString('latin1');
}

export function isMeaningfulPdfText(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(t)) return false;
  return true;
}

export function extractPdfText(rawBuffer) {
  const buf = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer || '');
  const streams = [];
  const text = buf.toString('latin1');
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = streamRe.exec(text)) !== null) {
    streams.push({ start: m.index, data: Buffer.from(m[1] || '', 'latin1') });
  }

  const decodedBlocks = [];
  const pushDecoded = (b) => {
    const s = Buffer.isBuffer(b) ? b.toString('latin1') : String(b || '');
    if (s) decodedBlocks.push(s);
  };

  pushDecoded(buf);
  for (const s of streams) {
    const around = text.slice(Math.max(0, s.start - 220), s.start + 40);
    const mayFlate = /FlateDecode/i.test(around);
    if (mayFlate) {
      try { pushDecoded(zlib.inflateSync(s.data)); continue; } catch (e) { /* ignore */ }
      try { pushDecoded(zlib.inflateRawSync(s.data)); continue; } catch (e) { /* ignore */ }
    }
    pushDecoded(s.data);
  }

  const chunks = [];
  const tokenRe = /\((?:\\.|[^\\()])*\)|<([0-9A-Fa-f\s]+)>/g;
  decodedBlocks.forEach((blk) => {
    let t;
    while ((t = tokenRe.exec(blk)) !== null) {
      if (t[0]?.startsWith('(')) {
        const plain = decodePdfLiteralText(t[0]).trim();
        if (isMeaningfulPdfText(plain)) chunks.push(plain);
      } else if (t[1]) {
        const plain = decodePdfHexToken(t[1]).trim();
        if (isMeaningfulPdfText(plain)) chunks.push(plain);
      }
    }
  });

  return chunks.join('\n');
}

export function nfkcNormalize(s) {
  let out = String(s || '');
  try { out = out.normalize('NFKC'); } catch (e) { /* ignore */ }
  // CJK Radicals Supplement chars that NFKC misses (pdftotext outputs these)
  const radicalMap = {
    '\u2E81': '丨', '\u2E84': '丶', '\u2E85': '丿', '\u2E86': '乀', '\u2E87': '乁',
    '\u2E88': '亅', '\u2E8B': '冫', '\u2E8C': '冖', '\u2E97': '匕', '\u2E98': '匚',
    '\u2E9C': '厂', '\u2E9F': '又', '\u2EA5': '女', '\u2EAA': '宀', '\u2EAB': '寸',
    '\u2EAD': '尢', '\u2EB3': '巛', '\u2EB6': '干', '\u2EB7': '幺', '\u2EBB': '弓',
    '\u2EBC': '彐', '\u2EBE': '彡', '\u2EC0': '彳', '\u2EC6': '戈', '\u2EC8': '手',
    '\u2ECA': '支', '\u2ECC': '文', '\u2ECD': '斗', '\u2ECF': '方', '\u2ED1': '日',
    '\u2ED4': '木', '\u2ED6': '欠', '\u2ED7': '止', '\u2ED8': '歹', '\u2EDA': '毋',
    '\u2EDB': '比', '\u2EDC': '毛', '\u2EDD': '食', // ⻝ → 食 (critical for this PDF)
    '\u2EDE': '氏', '\u2EDF': '气', '\u2EE0': '水', '\u2EE1': '火', '\u2EE2': '爪',
    '\u2EE3': '父', '\u2EE4': '爻', '\u2EE5': '片', '\u2EE8': '犬', '\u2EEB': '玄',
    '\u2EED': '瓜', '\u2EEF': '甘', '\u2EF0': '生', '\u2EF2': '疋', '\u2EF3': '疒',
  };
  out = out.replace(/[\u2E80-\u2EFF]/g, (ch) => radicalMap[ch] || ch);
  return out;
}

function linesToPdfMatrix(lines) {
  return lines
    .map((line) => {
      if (/\t/.test(line)) return line.split(/\t+/).map((x) => x.trim());
      if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((x) => x.trim());
      if (/,/.test(line)) return line.split(',').map((x) => x.trim());
      return [line];
    })
    .filter((arr) => arr.some(Boolean));
}

function parsePdfDetailRowsFromLines(deps, lines, bizType, date, parsedStore, weather) {
  const grouped = new Map();
  lines.forEach((line) => {
    const m2 = line.match(/(\d{1,2}\s*[:：]\s*\d{1,2}\s*[~～\-—–至到]\s*\d{1,2}\s*[:：]\s*\d{1,2}).*?([^\d]{2,}?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s|$)/);
    if (!m2) return;
    const slot = deps.normalizeForecastSlotFromHourRange(m2[1]);
    const product = String(m2[2] || '').trim();
    const qty = Number(m2[3]);
    const amount = Number(m2[4]);
    if (!slot || !product || deps.isExcludedForecastProduct(product) || !Number.isFinite(qty) || qty <= 0) return;
    const key = `${bizType}||${slot}||${date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        store: parsedStore,
        bizType,
        slot,
        date,
        weather,
        isHoliday: false,
        expectedRevenue: 0,
        productQuantities: {}
      });
    }
    const row = grouped.get(key);
    if (!row.store && parsedStore) row.store = parsedStore;
    row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + (Number.isFinite(amount) ? amount : 0)).toFixed(2));
    row.productQuantities[product] = Number((Number(row.productQuantities[product] || 0) + qty).toFixed(2));
  });
  return Array.from(grouped.values()).filter((x) => x.bizType && x.slot && x.date && Object.keys(x.productQuantities || {}).length);
}

function extractPdfMetaFromText(deps, text, fallbackBizType) {
  const dateMatch = text.match(/(20\d{2}[\-\/.年]\d{1,2}[\-\/.月]\d{1,2})/);
  const date = deps.normalizeForecastUploadDate(dateMatch ? dateMatch[1] : '');
  const storeMatch = text.match(/(?:门店|店铺|商户|销售门店|门店名称)\s*[：:]\s*([^\n,，;；]+)/);
  const parsedStore = deps.normalizeForecastStoreName(storeMatch ? storeMatch[1] : '');
  const weatherMatch = text.match(/(晴|阴|多云|小雨|中雨|大雨|暴雨|雨|雪|雾|风)/);
  const weather = deps.normalizeForecastWeather(weatherMatch ? weatherMatch[1] : '');
  const bizRaw = /外卖|外送/.test(text) ? '外卖' : (/堂食|堂吃/.test(text) ? '堂食' : fallbackBizType);
  const bizType = deps.normalizeForecastBizType(bizRaw) || 'dinein';
  return { date, parsedStore, weather, bizType };
}

export function parseInventoryForecastRowsFromPdfBuffer(deps, rawBuffer, fallbackBizType = '', options = {}) {
  const text = nfkcNormalize(extractPdfText(rawBuffer));
  if (!text) return [];

  const lines = String(text)
    .split(/\r?\n/)
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const matrix = linesToPdfMatrix(lines);
  let parsed = deps.parseInventoryForecastRowsFromTableMatrix(matrix, fallbackBizType, options);
  if (parsed.length) return parsed;

  const { date, parsedStore, weather, bizType } = extractPdfMetaFromText(deps, text, fallbackBizType);
  if (!date) return [];

  const detailRows = [];
  lines.forEach((line) => {
    const m2 = line.match(/(\d{1,2}\s*[:：]\s*\d{1,2}\s*[~～\-—–至到]\s*\d{1,2}\s*[:：]\s*\d{1,2}).*?([^\d]{2,}?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s|$)/);
    if (!m2) return;
    const slot = deps.normalizeForecastSlotFromHourRange(m2[1]);
    const product = String(m2[2] || '').trim();
    const qty = Number(m2[3]);
    const amount = Number(m2[4]);
    if (!slot || !product || deps.isExcludedForecastProduct(product) || !Number.isFinite(qty) || qty <= 0) return;
    detailRows.push({ slot, product, qty, amount: Number.isFinite(amount) ? amount : 0 });
  });
  if (!detailRows.length) return [];

  const grouped = new Map();
  detailRows.forEach((it) => {
    const key = `${bizType}||${it.slot}||${date}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        store: parsedStore,
        bizType,
        slot: it.slot,
        date,
        weather,
        isHoliday: false,
        expectedRevenue: 0,
        productQuantities: {}
      });
    }
    const row = grouped.get(key);
    if (!row.store && parsedStore) row.store = parsedStore;
    row.expectedRevenue = Number((Number(row.expectedRevenue || 0) + Number(it.amount || 0)).toFixed(2));
    row.productQuantities[it.product] = Number((Number(row.productQuantities[it.product] || 0) + Number(it.qty || 0)).toFixed(2));
  });

  return Array.from(grouped.values()).filter((x) => x.bizType && x.slot && x.date && Object.keys(x.productQuantities || {}).length);
}

export function parseInventoryForecastRowsFromPdfPath(deps, pdfPath, fallbackBizType = '', options = {}) {
  const p = String(pdfPath || '').trim();
  if (!p) return [];
  try {
    const out = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', p, '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
      maxBuffer: 12 * 1024 * 1024
    });
    const text = nfkcNormalize(String(out || '')).trim();
    if (!text) return [];
    log.debug({
      msg: 'inventory_pdftotext_output',
      length: text.length,
      preview: text.slice(0, 300),
    });
    const lines = text.split(/\r?\n/).map((x) => String(x || '').trim()).filter(Boolean);
    if (!lines.length) return [];
    const matrix = lines.map((line) => {
      if (/\t/.test(line)) return line.split(/\t+/).map((x) => x.trim());
      if (/ {2,}/.test(line)) return line.split(/ {2,}/).map((x) => x.trim());
      if (/,/.test(line)) return line.split(',').map((x) => x.trim());
      return [line];
    });
    const parsed = deps.parseInventoryForecastRowsFromTableMatrix(matrix, fallbackBizType, options);
    if (parsed.length) return parsed;

    const { date, parsedStore, weather, bizType } = extractPdfMetaFromText(deps, text, fallbackBizType);
    if (!date) return [];
    return parsePdfDetailRowsFromLines(deps, lines, bizType, date, parsedStore, weather);
  } catch (e) {
    return [];
  }
}

export function createPdfParseHelpers(deps) {
  const bound = {
    ...deps,
    parseInventoryForecastRowsFromTableMatrix: deps.parseInventoryForecastRowsFromTableMatrix,
  };
  return {
    parseInventoryForecastRowsFromPdfBuffer: (rawBuffer, fallbackBizType = '', options = {}) =>
      parseInventoryForecastRowsFromPdfBuffer(bound, rawBuffer, fallbackBizType, options),
    parseInventoryForecastRowsFromPdfPath: (pdfPath, fallbackBizType = '', options = {}) =>
      parseInventoryForecastRowsFromPdfPath(bound, pdfPath, fallbackBizType, options),
    nfkcNormalize,
  };
}
