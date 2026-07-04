/**
 * 与 agents-service-v2 对齐：
 * - `daily_reports` / 内存日报：`anomaly-engine.js` 的 `dailyReportIlikePatterns`（expandAgentStoreLabels → %…%）
 * - 桌访/飞书多维表字段：`utils/store-sql-patterns.js` 的 `feishuStoreSearchPatterns`
 *
 * 2026-07-04：门店名双轨映射已收口进store_name_aliases表(migration 096)，此文件此前
 * 用STORE_TO_FEISHU手工维护、并靠注释人工保证与agents-service-v2/store-mapping.js一致——
 * 是同一份逻辑的第5处独立硬编码副本。现在改为读同一张表的缓存，见utils/store-alias-cache.js。
 */
import {
  resolveCanonicalStoreNameFuzzySync,
  resolveAliasBySourceSync,
} from './utils/store-alias-cache.js';

export function resolveAgentCanonicalStore(input) {
  return resolveCanonicalStoreNameFuzzySync(input);
}

export function toFeishuStoreName(storeName) {
  return resolveAliasBySourceSync(storeName, 'feishu');
}

/** 与 agents `store-mapping.normalizeAgentMaterialBrand` 一致 */
export function normalizeAgentMaterialBrand(raw) {
  const b = String(raw || '').trim();
  const l = b.toLowerCase();
  if (!b) return '';
  if (l === 'majixian' || b === '马己仙') return '马己仙';
  if (l === 'hongchao' || b === '洪潮') return '洪潮';
  return b;
}

export function expandAgentStoreLabels(input) {
  const raw = String(input || '').trim();
  const canon = resolveAgentCanonicalStore(raw);
  const out = new Set([raw, canon].filter(Boolean));
  const f1 = toFeishuStoreName(canon);
  if (f1) out.add(f1);
  const f2 = toFeishuStoreName(raw);
  if (f2) out.add(f2);
  return [...out];
}

/** 与 V2 `anomaly-engine.dailyReportIlikePatterns` 一致 */
export function dailyReportIlikePatterns(store) {
  const labs = expandAgentStoreLabels(String(store || '').trim());
  const pats = labs.map((lab) => `%${String(lab).replace(/%/g, '')}%`);
  return pats.length ? pats : [`%${String(store || '').replace(/%/g, '')}%`];
}

/**
 * 与 V2 `utils/store-sql-patterns.feishuStoreSearchPatterns` 一致（空输入返回 `['%']`，与 V2 相同）
 * @returns {string[]} 用于 SQL `ILIKE ANY($n::text[])`（已含 %）
 */
export function feishuStoreSearchPatterns(hrmsStoreName) {
  const s = String(hrmsStoreName || '').trim();
  if (!s) return ['%'];
  const out = new Set();
  const add = (p) => {
    const t = String(p || '').trim();
    if (t.length >= 2) out.add(t);
  };
  for (const lab of expandAgentStoreLabels(s)) {
    add(`%${lab.replace(/%/g, '')}%`);
  }
  add(`%${s}%`);
  const feishu = toFeishuStoreName(s);
  if (feishu && feishu !== s) add(`%${feishu}%`);
  if (/马己仙/.test(s)) {
    add('%马己仙%');
    add('%马己仙大宁%');
    add('%马己仙上海音乐%');
    add('%音乐广场%');
  }
  if (/洪潮/.test(s)) {
    add('%洪潮%');
    add('%洪潮久光%');
    add('%洪潮大宁%');
    add('%大宁久光%');
  }
  const arr = [...out];
  return arr.length ? arr : [`%${s}%`];
}

function rowMatchesIlikeAnyPatterns(pats, reportStoreValue) {
  if (!Array.isArray(pats) || !pats.length) return false;
  const sv = String(reportStoreValue ?? '').trim();
  if (!sv) return false;
  for (const p of pats) {
    const inner = String(p).replace(/^%+/, '').replace(/%+$/, '');
    if (inner === '') return true;
    const lo = sv.toLowerCase();
    if (lo.includes(inner.toLowerCase())) return true;
  }
  return false;
}

/** 内存中的营业日报行是否与 V2 `daily_reports` + `ILIKE ANY(dailyReportIlikePatterns(...))` 等价 */
export function dailyReportRowMatches(hrmsStoreLabel, reportStoreValue) {
  if (!String(hrmsStoreLabel || '').trim()) return false;
  return rowMatchesIlikeAnyPatterns(dailyReportIlikePatterns(hrmsStoreLabel), reportStoreValue);
}

/** 桌访 structured 行 / 飞书通用表「门店」字段：与 V2 `feishuStoreSearchPatterns` + ILIKE ANY 口径一致 */
export function feishuTableRowMatches(hrmsStoreLabel, rowStoreValue) {
  if (!String(hrmsStoreLabel || '').trim()) return false;
  return rowMatchesIlikeAnyPatterns(feishuStoreSearchPatterns(hrmsStoreLabel), rowStoreValue);
}
