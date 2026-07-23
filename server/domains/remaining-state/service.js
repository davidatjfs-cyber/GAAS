/**
 * A3 收尾：仍住在 hrms_state、但禁止 PUT /api/state 覆盖的业务字段。
 * 提供窄 API 写路径（announcements / exam* / trainingMaterials / users）。
 */

export function normalizeUserRecord(u) {
  if (!u || typeof u !== 'object') return null;
  const username = String(u.username || '').trim();
  if (!username) return null;
  const out = { ...u, username };
  if (u.name != null) out.name = String(u.name || '').trim();
  if (u.role != null) out.role = String(u.role || '').trim();
  if (u.store != null) out.store = String(u.store || '').trim();
  if (u.status != null) out.status = String(u.status || 'active').trim() || 'active';
  else if (!out.status) out.status = 'active';
  return out;
}

export function upsertUsersInList(existing, incoming) {
  const list = Array.isArray(existing) ? existing.slice() : [];
  const by = new Map(list.map((u) => [String(u?.username || '').trim().toLowerCase(), u]));
  const items = Array.isArray(incoming) ? incoming : [incoming];
  const out = [];
  for (const raw of items) {
    const u = normalizeUserRecord(raw);
    if (!u) continue;
    const key = u.username.toLowerCase();
    const prev = by.get(key) || {};
    // 空字符串不覆盖已有字段（patch 语义）
    const merged = { ...prev };
    for (const [k, v] of Object.entries(u)) {
      if (v === '' && prev[k] != null && prev[k] !== '') continue;
      merged[k] = v;
    }
    by.set(key, merged);
    out.push(merged);
  }
  return { list: Array.from(by.values()), upserted: out };
}

export function removeUserFromList(existing, username) {
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) return { ok: false, code: 'missing_username', list: existing };
  const list = Array.isArray(existing) ? existing : [];
  const next = list.filter((u) => String(u?.username || '').trim().toLowerCase() !== uname);
  if (next.length === list.length) return { ok: false, code: 'not_found', list };
  return { ok: true, list: next };
}

export function removeAnnouncementFromList(existing, id) {
  const annId = String(id || '').trim();
  if (!annId) return { ok: false, code: 'missing_id', list: existing };
  const list = Array.isArray(existing) ? existing : [];
  const next = list.filter((a) => String(a?.id || '') !== annId);
  if (next.length === list.length) return { ok: false, code: 'not_found', list };
  return { ok: true, list: next };
}
