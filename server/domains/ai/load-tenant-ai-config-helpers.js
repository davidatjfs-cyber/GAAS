/**
 * Resolve tenant-scoped AI config from hrms_state.settings.llm.
 */
import { normalizeOpenAiCompatibleBaseUrlForTenant } from './llm-provider-helpers.js';

/**
 * @param {object} deps
 * @param {() => string} deps.resolveTenantIdDefault
 * @param {{ query: Function }} deps.agentPool
 * @param {{ warn: Function }} deps.log
 * @param {string} [featureKey]
 */
export async function loadTenantAiConfigBody(deps, featureKey = 'default') {
  const { resolveTenantIdDefault, agentPool, log } = deps;
  try {
    const tenantId = resolveTenantIdDefault();
    if (!tenantId || tenantId === 'default') return null;
    const r = await agentPool.query('SELECT data FROM hrms_state WHERE key = $1 LIMIT 1', [tenantId]);
    const llm = r.rows?.[0]?.data?.settings?.llm;
    if (!llm || typeof llm !== 'object') return null;

    let models = Array.isArray(llm.models) ? llm.models : [];
    let bindings = { ...(llm.bindings || {}) };
    if (!models.length) {
      const legacyKey = String(llm.apiKey || '').trim();
      if (!legacyKey && !llm.baseUrl && !llm.model) return null;
      models = [
        {
          id: 'legacy_default',
          baseUrl: llm.baseUrl,
          model: llm.model,
          apiKey: legacyKey,
          enabled: true,
        },
      ];
      bindings = { default: 'legacy_default' };
    }

    const key = String(featureKey || 'default').trim() || 'default';
    const boundId = String(bindings?.[key] || bindings?.default || '').trim();
    let m = models.find((x) => x?.id === boundId && x?.enabled !== false);
    if (!m) m = models.find((x) => x?.enabled !== false);
    if (!m?.apiKey || !m?.baseUrl || !m?.model) return null;

    return {
      apiKey: String(m.apiKey).trim(),
      baseUrl: normalizeOpenAiCompatibleBaseUrlForTenant(m.baseUrl),
      model: String(m.model).trim(),
    };
  } catch (e) {
    log.warn('[agents] loadTenantAiConfig failed, falling back to platform config:', e?.message);
    return null;
  }
}
