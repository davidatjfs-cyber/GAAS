/**
 * callLLM body helpers (P2 peel from agents.js).
 */
import {
  getLLMClientConfig,
  getPlatformLlmEnv,
  getProviderHealthStatus,
  getTextFallbackChain,
  isProviderHealthy,
  isRetryableLLMError,
  markProviderFail,
  markProviderOk,
  resolveModelProvider,
  sleep,
} from './llm-provider-helpers.js';

/**
 * Build temperature / maxTokens / selected model / fallback chain for one callLLM invocation.
 */
export function buildCallLlmPlan(deps, messages, options = {}) {
  const {
    isExternalEnabled,
    isAiQualityExternalEnabled,
    getModelTier,
    getModelForRole,
    getTemperatureForRole,
    getMaxTokensForRole,
    isTierBudgetExceeded,
    tenantContext,
    resolveTenantLlmConfig,
  } = deps;

  const platformQuality = options.platformQuality === true;
  if (!isExternalEnabled() && !(platformQuality && isAiQualityExternalEnabled())) {
    return { early: { ok: false, error: 'external_disabled', content: '' } };
  }

  const env = getPlatformLlmEnv();
  const role = String(options.role || '').trim();
  const purpose = String(options.purpose || 'reasoning').trim();
  const tier = role ? getModelTier(role) : '';
  const tierModel = role ? getModelForRole(role, purpose) : '';

  return {
    early: null,
    platformQuality,
    role,
    purpose,
    tier,
    env,
    async resolveTenantModels() {
      const tenantId = String(options.tenantId || tenantContext.getStore() || '').trim();
      const tenantLlmConfig =
        !platformQuality && tenantId ? await resolveTenantLlmConfig(tenantId) : null;
      const tenantModels = Array.isArray(tenantLlmConfig?.models) ? tenantLlmConfig.models : [];
      return { tenantId, tenantModels };
    },
    selectModelAndCfg(tenantModels) {
      const selectedModel =
        String(
          platformQuality
            ? env.AI_QUALITY_LLM_MODEL
            : options.model || tenantModels[0]?.model || tierModel || env.QWEN_MODEL
        ).trim() || env.QWEN_MODEL;
      const cfg = getLLMClientConfig(
        selectedModel,
        platformQuality
          ? { forceProvider: env.AI_QUALITY_LLM_PROVIDER }
          : tenantModels[0]?.provider
            ? { forceProvider: tenantModels[0].provider }
            : {}
      );
      if (platformQuality) {
        cfg.apiKey = env.AI_QUALITY_LLM_API_KEY;
        cfg.baseUrl = env.AI_QUALITY_LLM_BASE_URL;
      }
      const model = cfg.model;
      const apiKey = platformQuality
        ? env.AI_QUALITY_LLM_API_KEY
        : tenantModels[0]?.api_key || cfg.apiKey;
      return { selectedModel, cfg, model, apiKey };
    },
    computeSampling() {
      const budgetExceeded = !!(tier && isTierBudgetExceeded(tier));
      const defaultTemp = role ? getTemperatureForRole(role) : 0.1;
      const requestedTemp = Number(options.temperature ?? defaultTemp);
      const temperature = Number.isFinite(requestedTemp)
        ? budgetExceeded
          ? Math.min(0.05, requestedTemp)
          : requestedTemp
        : budgetExceeded
          ? 0
          : 0.1;
      const roleMaxTokens = role ? getMaxTokensForRole(role) : 1500;
      const requestedMax = Number(options.max_tokens ?? options.maxTokens ?? roleMaxTokens);
      const maxTokens = Number.isFinite(requestedMax)
        ? budgetExceeded
          ? Math.max(256, Math.min(600, requestedMax))
          : requestedMax
        : budgetExceeded
          ? 512
          : 1500;
      return { budgetExceeded, temperature, maxTokens };
    },
    buildFallbackChain(model, tenantModels) {
      const hasTools = !!(options.tools && options.tools.length > 0);
      const tenantChain = tenantModels.map((m) => ({
        provider: m.provider,
        model: m.model,
        apiKeyOverride: m.api_key || null,
      }));
      if (platformQuality) {
        return [
          {
            provider: env.AI_QUALITY_LLM_PROVIDER,
            model: env.AI_QUALITY_LLM_MODEL,
            apiKeyOverride: env.AI_QUALITY_LLM_API_KEY,
            baseUrlOverride: env.AI_QUALITY_LLM_BASE_URL,
          },
        ];
      }
      if (hasTools) return [{ provider: resolveModelProvider(model), model }];
      return tenantChain.length
        ? [...tenantChain, ...getTextFallbackChain(model)]
        : getTextFallbackChain(model);
    },
    hasTools: !!(options.tools && options.tools.length > 0),
    messages,
    options,
  };
}

/**
 * Attempt one provider candidate (with limited retries on transient errors).
 * @returns {Promise<{ resp: object|null, lastErr: Error|null, fbCfg: object }>}
 */
export async function attemptProviderCandidate(deps, candidate, usedProvider, payloadBase, options) {
  const { axios, log } = deps;
  const fbCfg = getLLMClientConfig(
    candidate.model,
    candidate.provider ? { forceProvider: candidate.provider } : {}
  );
  if (candidate.apiKeyOverride) fbCfg.apiKey = candidate.apiKeyOverride;
  if (candidate.baseUrlOverride) fbCfg.baseUrl = candidate.baseUrlOverride;
  if (!fbCfg.apiKey) return { resp: null, lastErr: null, fbCfg, skipped: true };

  const payload = { ...payloadBase, model: fbCfg.model };
  const maxAttempts = candidate.provider === usedProvider ? 2 : 1;
  let resp = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      resp = await axios.post(`${fbCfg.baseUrl}/chat/completions`, payload, {
        headers: {
          Authorization: `Bearer ${fbCfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: Number(options.timeout) > 0 ? Number(options.timeout) : 60000,
      });
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts && isRetryableLLMError(e)) {
        const waitMs = 600 * attempt;
        log.warn(
          `[LLM-FALLBACK] ${candidate.provider} transient error (attempt ${attempt}/${maxAttempts}), retry in ${waitMs}ms:`,
          e?.message || e
        );
        await sleep(waitMs);
        continue;
      }
    }
  }
  return { resp, lastErr, fbCfg, skipped: false };
}

/**
 * @param {object} deps
 * @param {unknown[]} messages
 * @param {object} [options]
 */
export async function callLLMBody(deps, messages, options = {}) {
  const {
    getCachedResponse,
    setCachedResponse,
    performanceMetrics,
    maskLLMMessages,
    sanitizeLLMOutputWithAudit,
    sanitizeLLMOutput,
    pool,
    trackLLMCall,
    trackLLMResult,
    log,
  } = deps;

  const plan = buildCallLlmPlan(deps, messages, options);
  if (plan.early) return plan.early;

  const { tenantId, tenantModels } = await plan.resolveTenantModels();
  const { model, apiKey } = plan.selectModelAndCfg(tenantModels);
  if (!apiKey) return { ok: false, error: 'no_api_key', content: '' };

  const { budgetExceeded, temperature, maxTokens } = plan.computeSampling();
  const cacheKey = `${tenantId || '__platform__'}:${model}:${JSON.stringify(messages.slice(-2))}:${temperature}:${plan.purpose}:${plan.role}`;

  const cachedResponse = getCachedResponse(cacheKey);
  if (cachedResponse && !options.skipCache) {
    return { ok: true, content: cachedResponse, cached: true };
  }

  const startTime = Date.now();
  performanceMetrics.totalCalls++;

  const fallbackChain = plan.buildFallbackChain(model, tenantModels);
  let usedModel = model;
  const usedProvider = resolveModelProvider(model);

  const payloadBase = {
    messages: maskLLMMessages(messages),
    temperature,
    max_tokens: maxTokens,
    top_p: budgetExceeded ? 0.7 : 0.9,
    frequency_penalty: 0.1,
    presence_penalty: 0.1,
  };
  if (plan.hasTools) {
    payloadBase.tools = options.tools;
    if (options.tool_choice) payloadBase.tool_choice = options.tool_choice;
  }

  for (const candidate of fallbackChain) {
    if (!isProviderHealthy(candidate.provider)) {
      log.info(`[LLM-FALLBACK] Skipping unhealthy provider: ${candidate.provider}`);
      continue;
    }

    const { resp, lastErr, fbCfg, skipped } = await attemptProviderCandidate(
      deps,
      candidate,
      usedProvider,
      payloadBase,
      options
    );
    if (skipped) continue;

    if (resp) {
      markProviderOk(candidate.provider);
      usedModel = fbCfg.model;

      const messageObj = resp.data?.choices?.[0]?.message || {};
      let content = messageObj.content || '';
      try {
        content = await sanitizeLLMOutputWithAudit(pool(), content, {
          operatorRole: plan.role || null,
        });
      } catch {
        content = sanitizeLLMOutput(content);
      }
      const responseTime = Date.now() - startTime;

      performanceMetrics.avgResponseTime =
        (performanceMetrics.avgResponseTime * (performanceMetrics.totalCalls - 1) + responseTime) /
        performanceMetrics.totalCalls;

      if (!options.skipCache && content && !messageObj.tool_calls) {
        setCachedResponse(cacheKey, content);
      }
      if (plan.tier && options.trackTier === true) {
        try {
          trackLLMCall(plan.tier, Number(resp.data?.usage?.total_tokens || 0));
        } catch {
          /* ignore */
        }
      }

      trackLLMResult(true);
      const isFallback = candidate.provider !== resolveModelProvider(model);
      if (isFallback) {
        log.info(
          `[LLM-FALLBACK] ✅ Succeeded via fallback: ${candidate.provider}/${fbCfg.model} (primary was ${resolveModelProvider(model)}/${model})`
        );
      }
      return {
        ok: true,
        content,
        message: messageObj,
        raw: resp.data,
        responseTime,
        budgetExceeded,
        fallbackUsed: isFallback ? candidate.provider : undefined,
        actualModel: usedModel,
      };
    }

    markProviderFail(candidate.provider);
    log.warn(
      `[LLM-FALLBACK] ❌ Provider ${candidate.provider}/${fbCfg.model} failed: ${lastErr?.message || 'unknown'}`
    );
  }

  performanceMetrics.errorCount++;
  trackLLMResult(false);
  log.error(
    '[agents] callLLM ALL providers failed for model chain:',
    fallbackChain.map((c) => c.provider).join(' → ')
  );
  return {
    ok: false,
    error: 'all_providers_failed',
    content: '',
    providerHealth: getProviderHealthStatus(),
  };
}
