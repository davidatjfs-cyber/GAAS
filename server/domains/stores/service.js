/**
 * 门店域：权威仍在 hrms_state.stores（尚无独立 stores 业务表作 SoT）。
 * A3：禁止经 PUT /api/state 覆盖；增删改走窄 API（含 DELETE）。
 */

export function findStoreIndex(stores, storeId) {
  const id = String(storeId || '').trim();
  if (!id) return -1;
  const list = Array.isArray(stores) ? stores : [];
  return list.findIndex((s) => String(s?.id || '').trim() === id || String(s?.name || '').trim() === id);
}

/**
 * @returns {{ ok: true, removed: object, stores: object[] } | { ok: false, code: string }}
 */
export function removeStoreFromList(stores, storeId) {
  const list = Array.isArray(stores) ? stores.slice() : [];
  const idx = findStoreIndex(list, storeId);
  if (idx < 0) return { ok: false, code: 'not_found' };
  const removed = list[idx];
  list.splice(idx, 1);
  return { ok: true, removed, stores: list };
}
