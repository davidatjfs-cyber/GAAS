/**
 * Agent 门店匹配纯 helpers（P2 peel from agents.js）。
 * normalizeStoreKey 复用 domains/shared/time-number，禁止再复制一份。
 */
import { normalizeStoreKey } from '../shared/time-number.js';

export { normalizeStoreKey };

export function findUserInState(state, username) {
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  const all = [
    ...(Array.isArray(state?.employees) ? state.employees : []),
    ...(Array.isArray(state?.users) ? state.users : []),
  ];
  return all.find((x) => String(x?.username || '').trim().toLowerCase() === u) || null;
}

export function normalizeStoreLike(v) {
  return `%${normalizeStoreKey(v)}%`;
}

export function normalizeStoreAliasKey(v) {
  return normalizeStoreKey(v).replace(/(上海|北京|深圳|广州|大宁|门店|店铺|店|商场|广场|购物中心)/g, '');
}

export function isExactSameStore(a, b) {
  return normalizeStoreKey(a) && normalizeStoreKey(a) === normalizeStoreKey(b);
}

export function isLikelySameStore(a, b) {
  const x = normalizeStoreKey(a);
  const y = normalizeStoreKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  const ax = normalizeStoreAliasKey(a);
  const by = normalizeStoreAliasKey(b);
  if (ax && by && (ax === by || ax.includes(by) || by.includes(ax))) return true;
  return false;
}

export function normalizeCanonicalStoreName(store, storeCanonicalMap) {
  if (!store) return store;
  const s = store.trim();
  for (const entry of storeCanonicalMap || []) {
    for (const kw of entry.keywords) {
      if (new RegExp(kw, 'i').test(s)) return entry.canonical;
    }
  }
  return s;
}
