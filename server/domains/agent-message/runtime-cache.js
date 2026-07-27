/**
 * Agent 消息短期上下文 / 响应缓存 / 性能计数（peel from agents.js）。
 * 可变状态唯一所有者：只通过 API 暴露，不导出可写 Map。
 */

const MAX_CONTEXT_LENGTH = 10;
const MAX_CONTEXT_USERS = 500;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CONTEXT_TTL_MS = 3600000;

/**
 * @param {object} deps
 * @param {() => string} deps.resolveTenantIdDefault
 */
export function createRuntimeCacheApi(deps) {
  const { resolveTenantIdDefault } = deps;

  const conversationContext = new Map();
  const responseCache = new Map();
  const performanceMetrics = {
    totalCalls: 0,
    cacheHits: 0,
    avgResponseTime: 0,
    errorCount: 0,
  };

  function contextKeyFor(userId) {
    return `${resolveTenantIdDefault()}::${String(userId || '').trim().toLowerCase()}`;
  }

  function getCachedResponse(cacheKey) {
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      performanceMetrics.cacheHits += 1;
      return cached.response;
    }
    return null;
  }

  function setCachedResponse(cacheKey, response) {
    responseCache.set(cacheKey, {
      response,
      timestamp: Date.now(),
    });

    if (responseCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of responseCache.entries()) {
        if (now - value.timestamp > CACHE_TTL_MS) {
          responseCache.delete(key);
        }
      }
    }
  }

  function updateContext(userId, role, content) {
    const contextKey = contextKeyFor(userId);
    if (!conversationContext.has(contextKey)) {
      conversationContext.set(contextKey, []);
    }
    const context = conversationContext.get(contextKey);
    context.push({ role, content, timestamp: Date.now() });

    if (context.length > MAX_CONTEXT_LENGTH) {
      context.shift();
    }

    const now = Date.now();
    while (context.length > 0 && now - context[0].timestamp > CONTEXT_TTL_MS) {
      context.shift();
    }

    if (conversationContext.size > MAX_CONTEXT_USERS) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, ctx] of conversationContext.entries()) {
        const lastTs = ctx.length > 0 ? ctx[ctx.length - 1].timestamp : 0;
        if (lastTs < oldestTime) {
          oldestTime = lastTs;
          oldestKey = key;
        }
      }
      if (oldestKey) conversationContext.delete(oldestKey);
    }
  }

  function getContext(userId) {
    return conversationContext.get(contextKeyFor(userId)) || [];
  }

  function clearCaches() {
    responseCache.clear();
    conversationContext.clear();
  }

  function clearExpiredResponseCache(now = Date.now()) {
    let cleaned = 0;
    for (const [key, value] of responseCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        responseCache.delete(key);
        cleaned += 1;
      }
    }
    return cleaned;
  }

  return {
    getCachedResponse,
    setCachedResponse,
    updateContext,
    getContext,
    clearCaches,
    clearExpiredResponseCache,
    performanceMetrics,
    getContextSize: () => conversationContext.size,
    getCacheSize: () => responseCache.size,
    CACHE_TTL_MS,
  };
}
