// Single source of truth for brand/store configuration.
// To add a new brand: add one row to the store_brands DB table (see utils/brand-config-loader.js).
// The STORES array below is kept only as a fallback for when the DB cache is empty.

import { getBrandForStoreSync } from './utils/brand-config-loader.js';
import { resolveTenantIdDefault } from './utils/database.js';

export const STORES = [
  { storeId: '51866138', name: '马己仙上海音乐广场店', brandName: '马己仙', smsSuffix: 'MAJIXIAN' },
  { storeId: '64822111', name: '洪潮大宁久光店',       brandName: '洪潮',   smsSuffix: 'HONGCHAO' },
];

export const STORE_BY_ID   = Object.fromEntries(STORES.map(s => [s.storeId, s]));
export const STORE_ID_TO_NAME = Object.fromEntries(STORES.map(s => [s.storeId, s.name]));
export const ALL_STORE_NAMES  = STORES.map(s => s.name);

// Returns env-var suffix for SMS templates: 'HONGCHAO', 'MAJIXIAN', or 'DEFAULT'
export function getStoreSmsEnvSuffix(storeId) {
  return getBrandForStoreSync(storeId, resolveTenantIdDefault())?.smsSuffix || STORE_BY_ID[String(storeId || '').trim()]?.smsSuffix || 'DEFAULT';
}

// Partial store/brand name → POS store_id
export function storeNameToId(name) {
  const s = String(name || '');
  return getBrandForStoreSync(s, resolveTenantIdDefault())?.storeId || STORES.find(st => s.includes(st.brandName))?.storeId || '';
}

// POS store_id → canonical store name
export function storeIdToName(storeId) {
  const s = String(storeId || '').trim();
  return getBrandForStoreSync(s, resolveTenantIdDefault())?.storeName || STORE_BY_ID[s]?.name || s;
}

// Infer brand name from any store/brand text
export function inferBrandFromStoreName(storeName) {
  const s = String(storeName || '').trim();
  return getBrandForStoreSync(s, resolveTenantIdDefault())?.brandName || STORES.find(st => s.includes(st.brandName))?.brandName || '';
}

// Normalize variant store name spellings → canonical DB name
export const STORE_CANONICAL_MAP = [
  { keywords: ['洪潮', 'hongchao'],                                    canonical: '洪潮大宁久光店' },
  { keywords: ['马己仙大宁', 'majixian.*daning', '马己仙.*大宁'],      canonical: '马己仙大宁店' },
  { keywords: ['马己仙.*音乐', '马己仙.*广场', 'majixian.*music'],     canonical: '马己仙上海音乐广场店' },
  { keywords: ['马己仙'],                                              canonical: '马己仙大宁店' },
];
