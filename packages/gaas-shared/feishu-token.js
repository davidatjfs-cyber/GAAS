/**
 * 飞书 tenant_access_token 获取（无业务配置依赖）。
 * 调用方可自行做缓存；本模块提供带可选内存缓存的便捷封装。
 */

const DEFAULT_BASE = 'https://open.feishu.cn/open-apis';
const _cache = new Map(); // key -> { token, expires }

/**
 * @param {{ appId: string, appSecret: string, baseUrl?: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<string>} tenant_access_token
 */
export async function fetchFeishuTenantAccessToken(opts = {}) {
  const appId = String(opts.appId || '').trim();
  const appSecret = String(opts.appSecret || '').trim();
  if (!appId || !appSecret) {
    throw new Error('missing_feishu_app_credentials');
  }
  const baseUrl = String(opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch_unavailable');
  }
  const resp = await fetchImpl(`${baseUrl}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json();
  if (data?.code !== 0 || !data?.tenant_access_token) {
    throw new Error(`feishu_token_failed: ${data?.msg || 'unknown'} (code: ${data?.code ?? 'n/a'})`);
  }
  return {
    token: String(data.tenant_access_token),
    expireSec: Number(data.expire) || 7200,
  };
}

/**
 * 带进程内缓存的 token 获取。
 * @param {{ appId: string, appSecret: string, cacheKey?: string, bufferMs?: number, forceRefresh?: boolean, baseUrl?: string, fetchImpl?: typeof fetch }} opts
 */
export async function getCachedFeishuTenantAccessToken(opts = {}) {
  const cacheKey = String(opts.cacheKey || `${opts.appId}`).trim() || 'default';
  const bufferMs = Number.isFinite(opts.bufferMs) ? opts.bufferMs : 5 * 60 * 1000;
  if (!opts.forceRefresh) {
    const hit = _cache.get(cacheKey);
    if (hit && Date.now() < hit.expires - bufferMs) return hit.token;
  }
  const { token, expireSec } = await fetchFeishuTenantAccessToken(opts);
  _cache.set(cacheKey, { token, expires: Date.now() + expireSec * 1000 });
  return token;
}

export function evictFeishuTokenCache(cacheKey) {
  if (cacheKey == null) _cache.clear();
  else _cache.delete(String(cacheKey));
}
