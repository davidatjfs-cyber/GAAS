/**
 * Data-auditor case handling / quality-autonomy / routing / agent-message pipeline wiring
 * (P17 peel from agents.js bottom `createXxx` wiring cluster).
 */
import { createHandleDataAuditorCase } from '../agent-message/handle-data-auditor-case.js';
import { createAgentQualityAutonomyApi } from '../agent-message/agent-quality-autonomy.js';
import { createRouteMessage } from '../agent-message/route-message.js';
import { createCheckAgentQualityApi } from '../agent-message/check-agent-quality.js';
import { createHandleAgentMessage } from '../agent-message/handle-agent-message.js';

/**
 * @param {object} deps
 */
export function wireMessage(deps) {
  const {
    pool,
    inferBrandFromStoreName,
    tryHandleBiByFunctionCalling,
    isFactLikeQuestion,
    buildBiFactSourceAudit,
    buildBiSourceAuditText,
    buildBiGroundingFacts,
    callLLM,
    getContext,
    updateContext,
    getSharedState,
    normalizeStoreKey,
    resolveDateRangeFromQuestion,
    buildSalesReport,
    buildBiDeterministicDataSourceCoverageReply,
    buildBiDeterministicDailyReportReply,
    buildBiDeterministicTableVisitReply,
    buildBiDeterministicSalesRawTopReply,
    buildBiDeterministicBadReviewReportReply,
    buildBiDeterministicClosingReportReply,
    buildBiDeterministicOpeningReportReply,
    buildBiDeterministicMaterialReportReply,
    buildBiDeterministicMeetingReportReply,
    buildBiDeterministicOpsReportCountReply,
    buildBiDeterministicLossReportReply,
    getFeatureFlags,
    resolveTenantIdDefault,
    normalizePlainText,
    recordAiInteraction,
    recordAiFeedback,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    prefixWithAgentName,
    log,
    matchAnalysisRule,
    logExecutorEvent,
    getAgentLongMemory,
    markQualityMetric,
    recordAgentQualityAudit,
    routeMessage,
    getBrandRuntimeConfig,
    runWithCheckAgent,
    enforceUnifiedQualityGate,
    setAgentLongMemory,
    getEmployeePositionForKb,
    queryKnowledgeBase,
    getOpsKnowledgeSupport,
    getOpsReasoningModel,
    auditImage,
    findStoreManager,
    createOrUpdateAutonomousDataTask,
    notifyAutonomousDataTaskOwner,
  } = deps;

  const handleDataAuditorCase = createHandleDataAuditorCase({
    pool,
    inferBrandFromStoreName,
    tryHandleBiByFunctionCalling,
    isFactLikeQuestion,
    buildBiFactSourceAudit,
    buildBiSourceAuditText,
    buildBiGroundingFacts,
    callLLM,
    getContext,
    updateContext,
    getSharedState,
    normalizeStoreKey,
    resolveDateRangeFromQuestion,
    buildSalesReport,
    buildBiDeterministicDataSourceCoverageReply,
    buildBiDeterministicDailyReportReply,
    buildBiDeterministicTableVisitReply,
    buildBiDeterministicSalesRawTopReply,
    buildBiDeterministicBadReviewReportReply,
    buildBiDeterministicClosingReportReply,
    buildBiDeterministicOpeningReportReply,
    buildBiDeterministicMaterialReportReply,
    buildBiDeterministicMeetingReportReply,
    buildBiDeterministicOpsReportCountReply,
    buildBiDeterministicLossReportReply,
    getFeatureFlags,
  });

  const agentQualityAutonomyApi = createAgentQualityAutonomyApi({
    pool,
    resolveTenantIdDefault,
    normalizeStoreKey,
    normalizePlainText,
    recordAiInteraction,
    recordAiFeedback,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    prefixWithAgentName,
    log,
  });

  const routeMessageApi = createRouteMessage({
    pool,
    callLLM,
    matchAnalysisRule,
    logExecutorEvent,
    getFeatureFlags,
    getAgentLongMemory,
  });

  const checkAgentQualityApi = createCheckAgentQualityApi({
    callLLM,
    log,
    markQualityMetric,
    recordAgentQualityAudit,
  });

  const handleAgentMessage = createHandleAgentMessage({
    pool,
    routeMessage,
    prefixWithAgentName,
    callLLM,
    getContext,
    updateContext,
    getBrandRuntimeConfig,
    getSharedState,
    inferBrandFromStoreName,
    runWithCheckAgent,
    enforceUnifiedQualityGate,
    markQualityMetric,
    setAgentLongMemory,
    getEmployeePositionForKb,
    queryKnowledgeBase,
    getOpsKnowledgeSupport,
    getOpsReasoningModel,
    auditImage,
    findStoreManager,
    createOrUpdateAutonomousDataTask,
    notifyAutonomousDataTaskOwner,
    handleDataAuditorCase,
  });

  return {
    handleDataAuditorCase,
    agentQualityAutonomyApi,
    routeMessage: routeMessageApi,
    checkAgentQualityApi,
    handleAgentMessage,
  };
}
