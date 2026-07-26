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
 *
 * 缓存命中时不发起网络请求。调用方若要区分「命中缓存」与「真的刷新了」，
 * 传 onRefresh 回调——只在真正打飞书接口拿到新 token 时触发一次。
 * （历史问题：调用方在每次调用后无条件打 "token refreshed" 日志，缓存命中
 * 也照打，导致日志量放大到 2 万条/天且文案误导。）
 *
 * @param {{ appId: string, appSecret: string, cacheKey?: string, bufferMs?: number, forceRefresh?: boolean, baseUrl?: string, fetchImpl?: typeof fetch, onRefresh?: (info: { cacheKey: string, expireSec: number }) => void }} opts
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
  if (typeof opts.onRefresh === 'function') {
    try {
      opts.onRefresh({ cacheKey, expireSec });
    } catch {
      /* 回调异常不影响 token 返回 */
    }
  }
  return token;
}

export function evictFeishuTokenCache(cacheKey) {
  if (cacheKey == null) _cache.clear();
  else _cache.delete(String(cacheKey));
}
