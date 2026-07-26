/** Pure merge helpers for startup tenant reconcile. */

/** Pure merge: DB base fields + state detail fields; keep state-only drafts. */
export function mergeDailyReportsForStartup(dbItems, existingArr) {
  const DETAIL_FIELDS = [
    'segments',
    'categories',
    'staff',
    'scheduleNextDay',
    'photos',
    'weather',
    'discount',
    'badReviews',
  ];
  const dbKeySet = new Set(dbItems.map((x) => `${x.date}|${x.store}`));
  const merged = dbItems.map((dbItem) => {
    const k = `${dbItem.date}|${dbItem.store}`;
    const stateItem = existingArr.find(
      (s) => `${String(s?.date || '').slice(0, 10)}|${String(s?.store || '').trim()}` === k
    );
    if (!stateItem?.data) return dbItem;
    const mergedData = { ...dbItem.data };
    for (const f of DETAIL_FIELDS) {
      const dbVal = dbItem.data[f];
      const stVal = stateItem.data[f];
      const dbEmpty =
        dbVal === undefined ||
        dbVal === null ||
        (typeof dbVal === 'object' && Object.keys(dbVal).length === 0) ||
        (Array.isArray(dbVal) && dbVal.length === 0);
      const stHas =
        stVal !== undefined &&
        stVal !== null &&
        (typeof stVal !== 'object' || Object.keys(stVal).length > 0) &&
        (!Array.isArray(stVal) || stVal.length > 0);
      if (dbEmpty && stHas) mergedData[f] = stVal;
    }
    return { ...dbItem, data: mergedData };
  });
  const stateOnlyItems = existingArr.filter((r) => {
    const k = `${String(r?.date || '').slice(0, 10)}|${String(r?.store || '').trim()}`;
    return !dbKeySet.has(k);
  });
  return { finalMerged: [...merged, ...stateOnlyItems], stateOnlyItems };
}

/** Pure merge: DB point_records authority; keep state-only ids not in DB. */
export function mergePointRecordsForStartup(dbPrItems, existingPr) {
  const dbPrIds = new Set(dbPrItems.map((x) => x.id));
  const stateOnlyPr = existingPr.filter((r) => r?.id && !dbPrIds.has(r.id));
  return { mergedPr: [...dbPrItems, ...stateOnlyPr], stateOnlyPr };
}
