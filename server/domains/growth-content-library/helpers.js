export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function normalizeStringArray(input) {
  return Array.isArray(input) ? input.filter(Boolean) : [];
}

export function parsePositiveId(raw) {
  const id = Number(raw);
  return id ? id : null;
}

/** Build WHERE + params for content-library listing. */
export function buildContentLibraryFilter(query) {
  const purpose = cleanText(query.purpose || '', 40);
  const channel = cleanText(query.channel || '', 40);
  const storeId = cleanText(query.store_id || '', 128);
  const conditions = ["gp.status IN ('generated','published')"];
  const params = [];
  let idx = 1;
  if (purpose) {
    conditions.push(`$${idx} = ANY(gp.purposes)`);
    params.push(purpose);
    idx++;
  }
  if (channel) {
    conditions.push(`$${idx} = ANY(gp.channels)`);
    params.push(channel);
    idx++;
  }
  if (storeId) {
    conditions.push(`(gp.store_id IS NULL OR gp.store_id = '' OR gp.store_id = $${idx})`);
    params.push(storeId);
    idx++;
  }
  return { conditions, params };
}
