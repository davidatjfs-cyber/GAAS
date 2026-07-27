/**
 * Agent 消息运行时：缓存 + 检索（peel from agents.js）。
 * 工厂只做装配；状态在 runtime-cache，查询在 runtime-queries。
 */
import { createRuntimeCacheApi } from './runtime-cache.js';
import { createRuntimeQueriesApi } from './runtime-queries.js';

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {() => string} deps.resolveTenantIdDefault
 * @param {() => Promise<object>} deps.getSharedState
 * @param {{ error: Function, info?: Function }} deps.log
 * @param {() => Promise<{ ragQuery?: Function }|null>} [deps.importRagTool]
 */
export function createAgentMessageRuntime(deps) {
  const cache = createRuntimeCacheApi({
    resolveTenantIdDefault: deps.resolveTenantIdDefault,
  });
  const queries = createRuntimeQueriesApi({
    pool: deps.pool,
    getSharedState: deps.getSharedState,
    log: deps.log,
    importRagTool: deps.importRagTool,
  });

  return {
    ...cache,
    ...queries,
  };
}
