/**
 * Data Auditor / margin / audit-image / ops-knowledge / BI function-tool wiring
 * (P17 peel from agents.js bottom `createXxx` wiring cluster).
 */
import { createTableVisitMetricsApi } from '../agent-auditor/table-visit-metrics.js';
import { createMarginMetricsApi } from '../agent-auditor/margin-metrics.js';
import { createAuditImage } from '../agent-ops/audit-image.js';
import { createGetOpsKnowledgeSupport } from '../agent-ops/knowledge-support.js';
import { createRunDataAuditor } from '../agent-auditor/run-data-auditor.js';
import { createRunBiFunctionTool } from '../agent-bi/run-bi-function-tool.js';

/**
 * @param {object} deps
 * @returns {{ tableVisitMetricsApi: object, marginMetricsApi: object, auditImage: Function,
 *   getOpsKnowledgeSupport: Function, runDataAuditor: Function, runBiFunctionTool: Function }}
 */
export function wireAuditor(deps) {
  const {
    pool,
    log,
    bitableConfigs,
    normalizeBitableDateValue,
    extractDissatisfactionDishFromFields,
    extractDissatisfactionReasonFromFields,
    extractBitableFieldText,
    inDateRangeInclusive,
    normalizeStoreKey,
    normProductKey,
    toNum,
    setReportPool,
    callVisionLLM,
    getOpsAgentConfig,
    callLLM,
    queryAgentData,
    getOpsReasoningModel,
    getSharedState,
    getStoresFromState,
    resolveBrandContextByStore,
    inferBrandFromStoreName,
    findStoreManager,
    refreshBiAgentRuntimeConfig,
    isBiSourceEnabled,
    getStoreThreshold,
    loadTableVisitMetricsByStore,
    checkDataSourceQuality,
    normalizeCanonicalStoreName,
    normalizeStoreLike,
    formatDate,
    logAgentOperation,
    isLikelySameStore,
    loadUnifiedTableVisitRowsByStore,
  } = deps;

  const tableVisitMetricsApi = createTableVisitMetricsApi({
    pool,
    bitableConfigs,
    normalizeBitableDateValue,
    extractDissatisfactionDishFromFields,
    extractDissatisfactionReasonFromFields,
    extractBitableFieldText,
    inDateRangeInclusive,
    normalizeStoreKey,
    normProductKey,
  });

  const marginMetricsApi = createMarginMetricsApi({
    pool,
    log,
    toNum,
    normProductKey,
    inDateRangeInclusive,
    normalizeStoreKey,
    setReportPool,
  });

  const auditImage = createAuditImage({
    pool,
    log,
    callVisionLLM,
    getOpsAgentConfig,
  });

  const getOpsKnowledgeSupport = createGetOpsKnowledgeSupport({
    log,
    callLLM,
    queryAgentData,
    getOpsAgentConfig,
    getOpsReasoningModel,
  });

  const runDataAuditor = createRunDataAuditor({
    pool,
    getSharedState,
    getStoresFromState,
    resolveBrandContextByStore,
    inferBrandFromStoreName,
    findStoreManager,
    refreshBiAgentRuntimeConfig,
    isBiSourceEnabled,
    getStoreThreshold,
    loadTableVisitMetricsByStore,
    checkDataSourceQuality,
    normalizeStoreKey,
    normalizeCanonicalStoreName,
  });

  const runBiFunctionTool = createRunBiFunctionTool({
    pool,
    normalizeStoreLike,
    formatDate,
    logAgentOperation,
    getBadReviewTableId: () => bitableConfigs?.bad_reviews?.tableId || '',
    normalizeBitableDateValue,
    extractBitableFieldText,
    isLikelySameStore,
    inDateRangeInclusive,
    loadUnifiedTableVisitRowsByStore,
  });

  return { tableVisitMetricsApi, marginMetricsApi, auditImage, getOpsKnowledgeSupport, runDataAuditor, runBiFunctionTool };
}
