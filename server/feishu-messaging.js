/**
 * Per-tenant Feishu (Lark) messaging app credentials + tenant_access_token cache.
 *
 * Historically sendLarkMessage/sendLarkCard (server/agents.js) only ever used the
 * platform's own global LARK_APP_ID/LARK_APP_SECRET, so an external tenant's own
 * Feishu self-built app was never used to deliver messages to that tenant's users,
 * even if a tenant_integrations row was configured for other purposes (e.g. Bitable
 * sync). This module lets a tenant override the app used for outbound messaging via
 * tenant_integrations (integration_key = 'feishu_bot': { app_id, app_secret }),
 * falling back to the platform's global app when a tenant has no override — this is
 * required by Feishu's own constraint that a self-built app can only message members
 * of the single Feishu corp it was created under.
 */
import axios from 'axios';
import { getTenantFeishuBotIntegration } from './tenant-integrations.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'feishu-messaging' });
const _tenantLarkTokens = new Map(); // tenantId -> { token, expires }

export async function resolveLarkAppCredentials(tenantId, pool, encryptionKey, globalAppId, globalAppSecret) {
  const id = String(tenantId || '').trim();
  if (id && id !== 'default' && pool && encryptionKey) {
    try {
      const cfg = await getTenantFeishuBotIntegration(pool, id, encryptionKey);
      if (cfg?.app_id && cfg?.app_secret) return cfg;
    } catch (e) {
      log.warn({
        msg: 'feishu_bot_config_unusable_fallback_global',
        tenant_id: id,
        err: e?.message || String(e),
      });
    }
  }
  return { app_id: globalAppId, app_secret: globalAppSecret };
}

/**
 * @param {string} tenantId - defaults to 'default' (the platform's own global app)
 * @param {object} deps - { pool, encryptionKey, globalAppId, globalAppSecret }
 */
export async function getLarkTenantToken(tenantId, deps) {
  const cacheKey = String(tenantId || 'default').trim() || 'default';
  const cached = _tenantLarkTokens.get(cacheKey);
  if (cached && Date.now() < cached.expires) return cached.token;

  const { pool, encryptionKey, globalAppId, globalAppSecret } = deps || {};
  const { app_id, app_secret } = await resolveLarkAppCredentials(cacheKey, pool, encryptionKey, globalAppId, globalAppSecret);
  if (!app_id || !app_secret) {
    log.error({ msg: 'feishu_no_app_credentials', tenant_id: cacheKey });
    return '';
  }

  try {
    const resp = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      app_id, app_secret
    }, { timeout: 10000 });

    const token = resp.data?.tenant_access_token || '';
    const expires = Date.now() + (resp.data?.expire || 7000) * 1000;
    _tenantLarkTokens.set(cacheKey, { token, expires });
    log.info({
      msg: 'feishu_tenant_token_refreshed',
      tenant_id: cacheKey,
      expire_s: resp.data?.expire,
    });
    return token;
  } catch (e) {
    log.error({
      msg: 'feishu_get_tenant_token_failed',
      tenant_id: cacheKey,
      err: e?.message || String(e),
    });
    return '';
  }
}

export function resetLarkTenantTokenCache(tenantId) {
  if (tenantId) _tenantLarkTokens.delete(String(tenantId).trim());
  else _tenantLarkTokens.clear();
}
