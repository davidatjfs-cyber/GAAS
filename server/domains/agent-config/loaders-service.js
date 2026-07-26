/**
 * Agent-config cached loaders — thin factory binding pool/log + cache state.
 */
import {
  clearAgentConfigCacheState,
  clearAgentRuleCacheState,
  clearBiAgentConfigCacheState,
  clearEmployeeRatingConfigCacheState,
  clearOpsAgentConfigCacheState,
  createLoaderCacheState,
  loadAgentConfig,
  loadAgentConfigs,
  loadAgentRules,
  loadBiAgentConfig,
  loadCategoryAssigneeRoleMap,
  loadEmployeeRatingConfig,
  loadIssueScoreRulesMap,
  loadOpsAgentConfig,
} from './config-loaders.js';

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {{ error: Function }} deps.log
 */
export function createAgentConfigLoaders(deps) {
  const cache = createLoaderCacheState();
  const bound = { ...deps, cache };

  return {
    clearAgentRuleCache: () => clearAgentRuleCacheState(cache),
    getAgentRules: () => loadAgentRules(bound, cache),
    getCategoryAssigneeRoleMap: () => loadCategoryAssigneeRoleMap(bound, cache),
    getIssueScoreRulesMap: () => loadIssueScoreRulesMap(bound, cache),
    clearAgentConfigCache: () => clearAgentConfigCacheState(cache),
    getAgentConfigs: () => loadAgentConfigs(bound, cache),
    getAgentConfig: (agentId) => loadAgentConfig(bound, cache, agentId),
    getOpsAgentConfig: () => loadOpsAgentConfig(bound, cache),
    clearOpsAgentConfigCache: () => clearOpsAgentConfigCacheState(cache),
    getBiAgentConfig: () => loadBiAgentConfig(bound, cache),
    clearBiAgentConfigCache: () => clearBiAgentConfigCacheState(cache),
    getEmployeeRatingConfig: () => loadEmployeeRatingConfig(bound, cache),
    clearEmployeeRatingConfigCache: () => clearEmployeeRatingConfigCacheState(cache),
  };
}
