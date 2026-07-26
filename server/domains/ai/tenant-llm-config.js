/**
 * Per-tenant encrypted LLM model config cache (P2 peel from agents.js).
 */

const TENANT_LLM_CONFIG_TTL_MS = 30_000;

/**
 * @param {object} deps
 * @param {() => { query?: Function }} deps.pool
 * @param {(pool: unknown, tenantId: string, encKey: string) => Promise<object|null>} deps.getTenantAiModelConfig
 * @param {() => number} [deps.nowFn]
 * @returns {{ resolveTenantLlmConfig: Function, invalidateTenantLlmConfigCache: Function, _resetForTests: Function }}
 */
export function createTenantLlmConfigCache(deps) {
  const { pool, getTenantAiModelConfig, nowFn = Date.now } = deps;
  const cache = new Map();

  function invalidateTenantLlmConfigCache(tenantId) {
    if (tenantId) cache.delete(String(tenantId).trim());
    else cache.clear();
  }

  async function resolveTenantLlmConfig(tenantId) {
    const id = String(tenantId || '').trim();
    if (!id) return null;
    const cached = cache.get(id);
    if (cached && nowFn() - cached.at < TENANT_LLM_CONFIG_TTL_MS) return cached.value;
    const encKey = String(process.env.TENANT_INTEGRATION_ENCRYPTION_KEY || '').trim();
    if (!encKey) return null;
    let value = null;
    try {
      value = await getTenantAiModelConfig(pool(), id, encKey);
    } catch {
      value = null;
    }
    cache.set(id, { value, at: nowFn() });
    return value;
  }

  return {
    resolveTenantLlmConfig,
    invalidateTenantLlmConfigCache,
    /** @internal */
    _resetForTests() {
      cache.clear();
    },
  };
}
