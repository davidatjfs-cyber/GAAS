/**
 * LLM provider config / health helpers (P2 peel from agents.js).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'ai', handler: 'llm-provider' });

const PROVIDER_FAIL_THRESHOLD = 2;
const PROVIDER_RECOVERY_CHECK_MS = 3 * 60 * 1000;

const _providerHealth = {
  deepseek: { healthy: true, failCount: 0, lastFailTime: 0, cooldownMs: 3 * 60 * 1000 },
  qwen: { healthy: true, failCount: 0, lastFailTime: 0, cooldownMs: 3 * 60 * 1000 },
  doubao: { healthy: true, failCount: 0, lastFailTime: 0, cooldownMs: 3 * 60 * 1000 },
};

/** @internal test helper */
export function _resetProviderHealthForTests() {
  for (const h of Object.values(_providerHealth)) {
    h.healthy = true;
    h.failCount = 0;
    h.lastFailTime = 0;
  }
}

export function getPlatformLlmEnv() {
  return {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    DEEPSEEK_VISION_MODEL: process.env.DEEPSEEK_VISION_MODEL || 'ep-20260424183833-7lr9g',
    QWEN_API_KEY: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '',
    QWEN_BASE_URL: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    QWEN_MODEL: process.env.QWEN_MODEL || 'qwen-max',
    DOUBAO_API_KEY: process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY || '',
    DOUBAO_BASE_URL: process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    AI_QUALITY_LLM_PROVIDER: String(process.env.AI_QUALITY_LLM_PROVIDER || 'deepseek').trim(),
    AI_QUALITY_LLM_MODEL: String(process.env.AI_QUALITY_LLM_MODEL || 'deepseek-chat').trim(),
    AI_QUALITY_LLM_API_KEY: String(process.env.AI_QUALITY_LLM_API_KEY || '').trim(),
    AI_QUALITY_LLM_BASE_URL: String(process.env.AI_QUALITY_LLM_BASE_URL || 'https://api.deepseek.com').trim(),
  };
}

export function resolveModelProvider(modelName, forceProvider) {
  if (forceProvider) return forceProvider;
  const m = String(modelName || '').trim().toLowerCase();
  if (m.startsWith('qwen') || m.includes('dashscope')) return 'qwen';
  if (m.startsWith('doubao') || m.startsWith('ep-') || m.includes('volces') || m.includes('ark')) {
    return 'doubao';
  }
  return 'deepseek';
}

/**
 * Tenant AI base URL normalizer (behavior-preserving from agents.js).
 * Slightly different from routes-chat-completions normalizeOpenAiCompatibleBaseUrl
 * (endsWith('/v1') vs /\\/v1$/i).
 */
export function normalizeOpenAiCompatibleBaseUrlForTenant(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/ark\.cn-beijing\.volces\.com/i.test(trimmed)) {
    if (/\/api\/v3$/i.test(trimmed)) return trimmed;
    if (/\/v1$/i.test(trimmed)) return trimmed.replace(/\/v1$/i, '/api/v3');
    return `${trimmed}/api/v3`;
  }
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

export function getLLMClientConfig(modelName, options = {}) {
  const env = getPlatformLlmEnv();
  const provider = resolveModelProvider(modelName, options.forceProvider || '');
  if (provider === 'qwen') {
    return {
      provider,
      model: String(modelName || '').trim() || env.QWEN_MODEL,
      apiKey: env.QWEN_API_KEY,
      baseUrl: env.QWEN_BASE_URL,
    };
  }
  if (provider === 'doubao') {
    return {
      provider,
      model: String(modelName || '').trim() || env.DEEPSEEK_VISION_MODEL,
      apiKey: env.DOUBAO_API_KEY,
      baseUrl: env.DOUBAO_BASE_URL,
    };
  }
  return {
    provider: 'deepseek',
    model: String(modelName || '').trim() || env.DEEPSEEK_MODEL,
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL,
  };
}

export function markProviderFail(provider) {
  const h = _providerHealth[provider];
  if (!h) return;
  h.failCount += 1;
  h.lastFailTime = Date.now();
  if (h.failCount >= PROVIDER_FAIL_THRESHOLD) {
    h.healthy = false;
    log.error(
      `[LLM-FALLBACK] Provider ${provider} marked UNHEALTHY after ${h.failCount} consecutive failures`
    );
  }
}

export function markProviderOk(provider) {
  const h = _providerHealth[provider];
  if (!h) return;
  const wasDown = !h.healthy;
  h.healthy = true;
  h.failCount = 0;
  if (wasDown) log.info(`[LLM-FALLBACK] Provider ${provider} recovered to HEALTHY`);
}

export function isProviderHealthy(provider) {
  const h = _providerHealth[provider];
  if (!h) return true;
  if (h.healthy) return true;
  if (Date.now() - h.lastFailTime > PROVIDER_RECOVERY_CHECK_MS) return true;
  return false;
}

export function getTextFallbackChain(primaryModel) {
  const env = getPlatformLlmEnv();
  const primary = resolveModelProvider(primaryModel);
  const chain = [{ provider: primary, model: primaryModel }];
  if (primary !== 'qwen' && env.QWEN_API_KEY) {
    chain.push({ provider: 'qwen', model: env.QWEN_MODEL });
  }
  if (primary !== 'deepseek' && env.DEEPSEEK_API_KEY) {
    chain.push({ provider: 'deepseek', model: env.DEEPSEEK_MODEL });
  }
  return chain;
}

export function getProviderHealthStatus() {
  const now = Date.now();
  const result = {};
  for (const [k, v] of Object.entries(_providerHealth)) {
    result[k] = {
      healthy: v.healthy,
      failCount: v.failCount,
      lastFailAgo: v.lastFailTime ? `${Math.round((now - v.lastFailTime) / 1000)}s ago` : 'never',
      effectivelyAvailable: isProviderHealthy(k),
    };
  }
  return result;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableLLMError(err) {
  const status = Number(err?.response?.status || 0);
  if ([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524].includes(status)) return true;
  const code = String(err?.code || '').toLowerCase();
  if (['econnreset', 'etimedout', 'eai_again', 'enotfound', 'ecanceled'].includes(code)) return true;
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('socket hang up') ||
    msg.includes('network error') ||
    msg.includes('bad record mac') ||
    msg.includes('incomplete envelope') ||
    msg.includes('tls')
  );
}
