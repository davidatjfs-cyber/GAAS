/**
 * 增长 Phase API 共用鉴权（从 growth-phases 抽出，供多域复用）。
 */
import jwt from 'jsonwebtoken';

export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

export function authPhaseApi(req) {
  const secret = cleanText(process.env.MINIPROGRAM_SYNC_SECRET || '', 500);
  if (!secret) return { ok: false, status: 503, error: 'miniprogram_sync_disabled' };
  const headerSecret = cleanText(req.headers['x-miniprogram-sync-secret'] || '', 500);
  const auth = cleanText(req.headers.authorization || '', 500);
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (headerSecret === secret || bearer === secret) return { ok: true, user: { username: 'system', role: 'system' } };
  if (bearer && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
      if (decoded && decoded.username) return { ok: true, user: { username: decoded.username, role: decoded.role || '' } };
    } catch {
      /* ignore */
    }
  }
  return { ok: false, status: 401, error: 'unauthorized' };
}

export function getPhaseApiTenantId(req) {
  const auth = cleanText(req.headers.authorization || '', 500);
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!bearer || !process.env.JWT_SECRET) return 'default';
  try {
    const decoded = jwt.verify(bearer, process.env.JWT_SECRET);
    return cleanText(decoded.tenant_id || 'default', 80) || 'default';
  } catch {
    return 'default';
  }
}

export function requirePhaseAuth(req, res) {
  const auth = authPhaseApi(req);
  if (!auth.ok) {
    res.status(auth.status).json({ ok: false, error: auth.error });
    return false;
  }
  return true;
}
