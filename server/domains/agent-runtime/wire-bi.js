/**
 * BI query helpers / function-calling / deterministic reply builders wiring
 * (P17 peel from agents.js bottom `createXxx` wiring cluster).
 */
import { createBiQueryHelpersApi } from '../agent-bi/bi-query-helpers.js';
import { createBiFunctionCallingSupport } from '../agent-bi/function-calling-support.js';
import { createTryHandleBiByFunctionCalling } from '../agent-bi/try-handle-bi-by-function-calling.js';
import { createBuildBiDeterministicDailyReportReply } from '../agent-bi/build-daily-report-reply.js';
import { createBuildBiDeterministicSalesRawTopReply } from '../agent-bi/build-sales-raw-top-reply.js';
import { createBuildBiDeterministicBadReviewReportReply } from '../agent-bi/build-bad-review-report-reply.js';
import { createDeterministicCascadeReplies } from '../agent-bi/deterministic-cascade-replies.js';

/**
 * @param {object} deps
 */
export function wireBi(deps) {
  const {
    pool,
    bitableConfigs,
    formatDate,
    normalizeStoreLike,
    normalizeStoreKey,
    isBiSourceEnabled,
    toDateOnly,
    extractBitableFieldText,
    normalizeBitableDateValue,
    isLikelySameStore,
    inDateRangeInclusive,
    loadUnifiedTableVisitRowsByStore,
    extractTableVisitItems,
    extractTableVisitDishes,
    callLLM,
    getBiReasoningModel,
    getModelTier,
    getAvailableTools,
    isToolAllowed,
    isTierBudgetExceeded,
    parseFeishuMarketingCopyTemplate,
    clampInt,
    runBiFunctionTool,
    buildBiFactSourceAudit,
    buildBiSourceAuditText,
    resolveDateRangeFromQuestion,
  } = deps;

  const biQueryHelpersApi = createBiQueryHelpersApi({
    formatDate,
    pool,
    normalizeStoreLike,
    normalizeStoreKey,
    isBiSourceEnabled,
    toDateOnly,
    extractBitableFieldText,
    normalizeBitableDateValue,
    isLikelySameStore,
    inDateRangeInclusive,
    loadUnifiedTableVisitRowsByStore,
    extractTableVisitItems,
  });

  const biFunctionCallingSupport = createBiFunctionCallingSupport({ callLLM, getBiReasoningModel });

  const tryHandleBiByFunctionCalling = createTryHandleBiByFunctionCalling({
    pool,
    getModelTier,
    getAvailableTools,
    isToolAllowed,
    isTierBudgetExceeded,
    parseFeishuMarketingCopyTemplate,
    clampInt,
    runBiFunctionTool,
    narrateBiToolResult: biFunctionCallingSupport.narrateBiToolResult,
    pushBiConversationTurn: biFunctionCallingSupport.pushBiConversationTurn,
    getBiConversationHistory: biFunctionCallingSupport.getBiConversationHistory,
    buildBiIntentPlan: biFunctionCallingSupport.buildBiIntentPlan,
    callLLM,
    getBiReasoningModel,
    BI_FUNCTION_TOOLS: biFunctionCallingSupport.BI_FUNCTION_TOOLS,
    parseToolArgs: biFunctionCallingSupport.parseToolArgs,
    buildBiFactSourceAudit,
    buildBiSourceAuditText,
  });

  const buildBiDeterministicDailyReportReply = createBuildBiDeterministicDailyReportReply({
    pool,
    resolveDateRangeFromQuestion,
    normalizeStoreLike,
    normalizeStoreKey,
  });

  const buildBiDeterministicSalesRawTopReply = createBuildBiDeterministicSalesRawTopReply({
    pool,
    resolveDateRangeFromQuestion,
    normalizeStoreKey,
    normalizeStoreLike,
  });

  const buildBiDeterministicBadReviewReportReply = createBuildBiDeterministicBadReviewReportReply({
    pool,
    resolveDateRangeFromQuestion,
    getBadReviewTableId: () => bitableConfigs?.bad_reviews?.tableId || '',
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    loadUnifiedTableVisitRowsByStore,
  });

  const cascadeBiReplies = createDeterministicCascadeReplies({
    pool,
    isBiSourceEnabled,
    resolveDateRangeFromQuestion,
    loadUnifiedTableVisitRowsByStore,
    extractTableVisitDishes,
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    getClosingTableId: () => bitableConfigs?.closing_reports?.tableId || '',
    getOpeningTableId: () => bitableConfigs?.opening_reports?.tableId || '',
    getMeetingTableId: () => bitableConfigs?.meeting_reports?.tableId || '',
    getLossTableId: () => bitableConfigs?.loss_reports?.tableId || '',
    getMaterialTableIds: () => [
      bitableConfigs?.material_hongchao?.tableId,
      bitableConfigs?.material_majixian?.tableId,
    ].filter(Boolean),
  });

  return {
    biQueryHelpersApi,
    tryHandleBiByFunctionCalling,
    buildBiDeterministicDailyReportReply,
    buildBiDeterministicSalesRawTopReply,
    buildBiDeterministicBadReviewReportReply,
    buildBiDeterministicDataSourceCoverageReply: cascadeBiReplies.buildBiDeterministicDataSourceCoverageReply,
    buildBiDeterministicTableVisitReply: cascadeBiReplies.buildBiDeterministicTableVisitReply,
    buildBiDeterministicOpsReportCountReply: cascadeBiReplies.buildBiDeterministicOpsReportCountReply,
    buildBiDeterministicClosingReportReply: cascadeBiReplies.buildBiDeterministicClosingReportReply,
    buildBiDeterministicOpeningReportReply: cascadeBiReplies.buildBiDeterministicOpeningReportReply,
    buildBiDeterministicMaterialReportReply: cascadeBiReplies.buildBiDeterministicMaterialReportReply,
    buildBiDeterministicMeetingReportReply: cascadeBiReplies.buildBiDeterministicMeetingReportReply,
    buildBiDeterministicLossReportReply: cascadeBiReplies.buildBiDeterministicLossReportReply,
  };
}
