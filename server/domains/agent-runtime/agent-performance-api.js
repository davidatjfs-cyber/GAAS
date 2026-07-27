/**
 * Agent cache / performance metrics surface (P20 peel from agents.js).
 */

/**
 * @param {object} deps
 * @param {object} deps.performanceMetrics mutable counters bag
 * @param {{ getContextSize: Function, getCacheSize: Function, clearCaches: Function, clearExpiredResponseCache: Function }} deps.agentMessageRuntime
 * @param {() => object} [deps.getAgentQualityMetrics]
 * @param {() => object} deps.getProviderHealthStatus
 * @param {{ info?: Function }} deps.log
 * @param {() => number} [deps.uptime]
 * @param {(fn: Function, ms: number) => any} [deps.setIntervalFn]
 */
export function createAgentPerformanceApi(deps) {
  const {
    performanceMetrics,
    agentMessageRuntime,
    getAgentQualityMetrics = () => ({}),
    getProviderHealthStatus,
    log,
    uptime = () => process.uptime(),
    setIntervalFn = setInterval,
  } = deps;

  function getAgentPerformanceMetrics() {
    return {
      ...performanceMetrics,
      cacheHitRate:
        performanceMetrics.totalCalls > 0
          ? (performanceMetrics.cacheHits / performanceMetrics.totalCalls * 100).toFixed(2) + '%'
          : '0%',
      contextSize: agentMessageRuntime.getContextSize(),
      cacheSize: agentMessageRuntime.getCacheSize(),
      quality: getAgentQualityMetrics(),
      providerHealth: getProviderHealthStatus(),
      uptime: uptime(),
    };
  }

  function clearAgentCache() {
    agentMessageRuntime.clearCaches();
    log.info('[agents] Cache cleared');
  }

  function startExpiredCacheCleanup(intervalMs = 10 * 60 * 1000) {
    return setIntervalFn(() => {
      const cleaned = agentMessageRuntime.clearExpiredResponseCache();
      if (cleaned > 0) {
        log.info(`[agents] Cleaned ${cleaned} expired cache entries`);
      }
    }, intervalMs);
  }

  return {
    getAgentPerformanceMetrics,
    clearAgentCache,
    startExpiredCacheCleanup,
  };
}
