/**
 * LLM health scheduler + tenant-config-aware call/vision LLM client wiring
 * (P17 peel from agents.js bottom `createXxx` wiring cluster).
 */
import { createLlmHealthSchedulerApi } from '../ai/llm-health-scheduler.js';
import { createTenantLlmConfigCache } from '../ai/tenant-llm-config.js';
import { createLoadTenantAiConfig } from '../ai/load-tenant-ai-config.js';
import { createCallLLM } from '../ai/call-llm.js';
import { createCallVisionLLM, createCallVisionLLMVideo } from '../ai/call-vision-llm.js';

/**
 * @param {object} deps
 * @returns {{ llmHealthSchedulerApi: object, invalidateTenantLlmConfigCache: Function,
 *   callLLM: Function, callVisionLLM: Function, callVisionLLMVideo: Function }}
 */
export function wireLlm(deps) {
  const {
    isExternalEnabled,
    axios,
    markProviderOk,
    markProviderFail,
    getSharedState,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    getScheduledTaskStatus,
    performanceMetrics,
    pool,
    tenantContext,
    getActiveTenantIds,
    runDataAuditor,
    pushIssuesToFeishu,
    pushIssueToAssignee,
    pushScoresToFeishu,
    log,
    providerConfig,
    getTenantAiModelConfig,
    resolveTenantIdDefault,
    agentPool,
    isAiQualityExternalEnabled,
    getModelTier,
    getModelForRole,
    getTemperatureForRole,
    getMaxTokensForRole,
    isTierBudgetExceeded,
    getCachedResponse,
    setCachedResponse,
    maskLLMMessages,
    sanitizeLLMOutputWithAudit,
    sanitizeLLMOutput,
    trackLLMCall,
    trackLLMResult,
    getOpsVisionModel,
  } = deps;

  const llmHealthSchedulerApi = createLlmHealthSchedulerApi({
    isExternalEnabled,
    axios,
    markProviderOk,
    markProviderFail,
    getSharedState,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    getScheduledTaskStatus,
    getPerformanceMetrics: () => performanceMetrics,
    pool,
    tenantContext,
    getActiveTenantIds,
    runDataAuditor,
    pushIssuesToFeishu,
    pushIssueToAssignee,
    pushScoresToFeishu,
    log,
    providerConfig,
  });

  const tenantLlm = createTenantLlmConfigCache({ pool, getTenantAiModelConfig });
  const loadTenantAiConfig = createLoadTenantAiConfig({ resolveTenantIdDefault, agentPool });

  const callLLM = createCallLLM({
    isExternalEnabled,
    isAiQualityExternalEnabled,
    getModelTier,
    getModelForRole,
    getTemperatureForRole,
    getMaxTokensForRole,
    isTierBudgetExceeded,
    tenantContext,
    resolveTenantLlmConfig: tenantLlm.resolveTenantLlmConfig,
    getCachedResponse,
    setCachedResponse,
    performanceMetrics,
    maskLLMMessages,
    axios,
    sanitizeLLMOutputWithAudit,
    sanitizeLLMOutput,
    pool,
    trackLLMCall,
    trackLLMResult,
  });

  const callVisionLLM = createCallVisionLLM({ loadTenantAiConfig, getOpsVisionModel, axios, trackLLMResult });
  const callVisionLLMVideo = createCallVisionLLMVideo({ loadTenantAiConfig, axios, trackLLMResult });

  return {
    llmHealthSchedulerApi,
    invalidateTenantLlmConfigCache: tenantLlm.invalidateTenantLlmConfigCache,
    callLLM,
    callVisionLLM,
    callVisionLLMVideo,
  };
}
