/**
 * Tenant AI config loader (P2 peel from agents.js loadTenantAiConfig).
 */
import { childLogger } from '../../utils/logger.js';
import { loadTenantAiConfigBody } from './load-tenant-ai-config-helpers.js';

const log = childLogger({ domain: 'ai', handler: 'load-tenant-ai-config' });

/**
 * @param {object} deps
 * @param {() => string} deps.resolveTenantIdDefault
 * @param {{ query: Function }} deps.agentPool
 * @returns {(featureKey?: string) => Promise<object|null>}
 */
export function createLoadTenantAiConfig(deps) {
  const merged = { ...deps, log };
  return async function loadTenantAiConfig(featureKey = 'default') {
    return loadTenantAiConfigBody(merged, featureKey);
  };
}
