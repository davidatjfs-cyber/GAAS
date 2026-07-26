/**
 * WeCom access_token fetch + cache (P4 peel from growth-api.js).
 */

/**
 * @param {{
 *   cleanText: (v: unknown, max?: number) => string,
 *   getWecomConfig: (pool: object) => Promise<object|null>,
 *   getStoreWecomConfig: (pool: object, storeId: string) => Promise<object|null>,
 *   caches: ReturnType<import('./token-cache.js').createWecomTokenCaches>,
 *   fetchFn?: typeof fetch,
 * }} deps
 */
export function createGetWecomAccessToken(deps) {
  const {
    cleanText,
    getWecomConfig,
    getStoreWecomConfig,
    caches,
    fetchFn = globalThis.fetch,
  } = deps;

  return async function getWecomAccessToken(pool, storeId) {
    const now = Date.now();
    let corpId;
    let corpSecret;

    if (storeId) {
      const cached = caches.getStoreCache(storeId);
      if (cached && cached.token && cached.expiresAt > now + 10000) return cached.token;
      const storeConfig = await getStoreWecomConfig(pool, storeId);
      if (storeConfig) {
        corpId = cleanText(storeConfig.corp_id, 200);
        corpSecret = cleanText(storeConfig.corp_secret, 500);
      } else {
        const globalConfig = await getWecomConfig(pool);
        corpId = cleanText(globalConfig?.corp_id, 200);
        corpSecret = cleanText(globalConfig?.corp_secret, 500);
      }
    } else {
      const growthCache = caches.getGrowthCache();
      if (growthCache.token && growthCache.expiresAt > now + 10000) return growthCache.token;
      const config = await getWecomConfig(pool);
      corpId = cleanText(config?.corp_id, 200);
      corpSecret = cleanText(config?.corp_secret, 500);
    }

    if (!corpId || !corpSecret) throw new Error('missing_wecom_config');
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(corpSecret)}`;
    const resp = await fetchFn(url, { method: 'GET' });
    const data = await resp.json();
    if (!resp.ok || Number(data?.errcode) !== 0 || !data?.access_token) {
      throw new Error(data?.errmsg || 'wecom_token_failed');
    }

    const token = cleanText(data.access_token, 500);
    const expiresAt = now + Math.max(300, Number(data.expires_in) || 7200) * 1000;

    if (storeId) {
      caches.setStoreCache(storeId, { token, expiresAt });
    } else {
      caches.setGrowthCache({ token, expiresAt, store_id: '' });
    }
    return token;
  };
}
