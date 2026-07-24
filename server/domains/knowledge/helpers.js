/**
 * Knowledge domain — pure helpers (no pool / req / res).
 */
import path from 'path';

function isUuid(input) {
  const v = String(input || '').trim();
  if (!v) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizeCreatedByUuid(input) {
  const v = String(input || '').trim();
  return isUuid(v) ? v : null;
}

function normalizeKnowledgeGroupName(input) {
  return String(input || '').trim().slice(0, 120);
}

function normalizeMultipartFilename(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  // Browser multipart can carry UTF-8 bytes decoded as latin1 by parser; recover when possible.
  try {
    const recovered = Buffer.from(raw, 'latin1').toString('utf8');
    const hasCjk = /[一-鿿]/.test(recovered);
    const rawLooksMojibake = /[ÃÂæçéèêëåäöø]/.test(raw);
    if (recovered && !recovered.includes('�') && (hasCjk || rawLooksMojibake)) {
      return recovered;
    }
  } catch (e) { /* ignore */ }
  return raw;
}

function normalizeKnowledgeTags(rawTags, feedAgent, brandScope) {
  let tags = [];
  if (Array.isArray(rawTags)) {
    tags = rawTags;
  } else if (typeof rawTags === 'string') {
    const s = rawTags.trim();
    if (s) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) tags = parsed;
      } catch (e) {
        tags = s.split(/[，,\/\s]+/g);
      }
    }
  }
  const clean = tags.map(t => String(t || '').trim()).filter(Boolean);
  const agent = String(feedAgent || '').trim();
  if (agent) clean.unshift(`agent:${agent}`);
  const scope = String(brandScope || '').trim();
  if (scope) clean.unshift(scope);
  const uniq = Array.from(new Set(clean));
  return uniq.length ? uniq : null;
}

function parseJsonStringArrayForAudience(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean);
  const s = String(raw).trim();
  if (!s) return [];
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    /* ignore */
  }
  return s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
}

function parseKnowledgeAudienceFromBody(body) {
  const t = String(body?.audienceType || body?.audience_type || 'all').trim().toLowerCase();
  if (t === 'store') {
    const stores = parseJsonStringArrayForAudience(body?.audienceStores ?? body?.audience_stores);
    if (stores.length) return { type: 'store', stores };
    const legacy = String(body?.audienceStore || body?.audience_store || '').trim();
    return legacy ? { type: 'store', store: legacy, stores: [legacy] } : { type: 'all' };
  }
  if (t === 'position') {
    const positions = parseJsonStringArrayForAudience(body?.audiencePositions ?? body?.audience_positions);
    if (positions.length) return { type: 'position', positions };
    const legacy = String(body?.audiencePosition || body?.audience_position || '').trim();
    return legacy ? { type: 'position', position: legacy, positions: [legacy] } : { type: 'all' };
  }
  return { type: 'all' };
}

function canViewerSeeKnowledgeAudience(viewer, audienceVal) {
  let a = audienceVal;
  if (a == null) return true;
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch {
      return true;
    }
  }
  if (typeof a !== 'object' || !a) return true;
  const t = String(a.type || 'all').toLowerCase();
  if (t === 'all' || !t) return true;
  if (t === 'store') {
    const list = [];
    if (Array.isArray(a.stores)) list.push(...a.stores.map((x) => String(x || '').trim()).filter(Boolean));
    const legacy = String(a.store || '').trim();
    if (legacy) list.push(legacy);
    const uniq = [...new Set(list)];
    if (!uniq.length) return false;
    const vs = String(viewer.store || '').trim();
    return uniq.some((s) => s === vs);
  }
  if (t === 'position') {
    const list = [];
    if (Array.isArray(a.positions)) list.push(...a.positions.map((x) => String(x || '').trim()).filter(Boolean));
    const legacy = String(a.position || '').trim();
    if (legacy) list.push(legacy);
    const uniq = [...new Set(list)];
    if (!uniq.length) return false;
    const vp = String(viewer.position || '').trim();
    const role = String(viewer.role || '');
    if (uniq.some((p) => p === vp)) return true;
    if (uniq.includes('系统管理员') && role === 'admin') return true;
    return false;
  }
  return true;
}


function resolveUploadsFile(uploadsDir, p) {
  const raw = String(p || '').trim();
  if (!raw) return null;

  // 1) absolute path under uploadsDir
  try {
    if (path.isAbsolute(raw)) {
      const absNorm = path.resolve(raw);
      const upNorm = path.resolve(uploadsDir) + path.sep;
      if (absNorm.startsWith(upNorm)) return absNorm;
    }
  } catch (e) { /* ignore */ }

  // 2) /uploads/... OR uploads/...
  const rel1 = raw.replace(/^\/uploads\//, '').replace(/^uploads\//, '');
  const rel = rel1;

  // Disallow traversal
  const normalized = path.posix.normalize(rel).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.includes('..')) return null;

  return path.join(uploadsDir, normalized);
}

export {
  isUuid,
  normalizeCreatedByUuid,
  normalizeKnowledgeGroupName,
  normalizeMultipartFilename,
  normalizeKnowledgeTags,
  parseJsonStringArrayForAudience,
  parseKnowledgeAudienceFromBody,
  canViewerSeeKnowledgeAudience,
  resolveUploadsFile,
};
