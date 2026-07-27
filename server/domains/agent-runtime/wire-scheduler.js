/**
 * Scheduled-task runtime / safety-check / store-rating / chief-evaluator / checklist wiring
 * (P17 peel from agents.js bottom `createXxx` wiring cluster).
 */
import { createScheduledTaskRuntimeApi } from '../agent-ops/scheduled-task-runtime.js';
import { createBuildScheduledTasksFromConfig } from '../agent-ops/build-scheduled-tasks-from-config.js';
import { createExecuteScheduledTask } from '../agent-ops/execute-scheduled-task.js';
import { createSendSafetyCheck } from '../agent-ops/send-safety-check.js';
import { createFetchStoreRatingForProfileDisplay } from '../agent-evaluator/fetch-store-rating-for-profile.js';
import { createRunChiefEvaluator } from '../agent-evaluator/run-chief-evaluator.js';
import { createSendScheduledChecklist } from '../agent-ops/send-scheduled-checklist.js';

/**
 * @param {object} deps
 */
export function wireScheduler(deps) {
  const {
    refreshOpsAgentRuntimeConfig,
    buildScheduledTasksFromConfig,
    executeScheduledTask,
    log,
    getOpsAgentConfig,
    isBlockedOpsChecklistPattern,
    sendScheduledChecklist,
    sendSafetyCheck,
    sendLarkMessage,
    pool,
    resolveAgentCanonicalStore,
    dailyReportIlikePatterns,
    feishuStoreSearchPatterns,
    getSharedState,
    getStoresFromState,
    resolveBrandContextByStore,
    inferBrandFromStoreName,
    getBrandRuntimeConfig,
    calculateStoreRating,
    calculateEmployeeScore,
    callLLM,
    isLikelySameStore,
    normalizeStoreKey,
    lookupFeishuUserByUsername,
    sendLarkCard,
    formatChecklistTypeLabel,
    getOpsChecklistItems,
    opsTaskReplyAuditLarkMd,
    shouldSkipHrmsScheduledChecklist,
    prefixWithAgentName,
  } = deps;

  const scheduledTaskRuntimeApi = createScheduledTaskRuntimeApi({
    refreshOpsAgentRuntimeConfig,
    buildScheduledTasksFromConfig,
    executeScheduledTask,
    log,
  });

  const buildScheduledTasksFromConfigApi = createBuildScheduledTasksFromConfig({
    getOpsAgentConfig,
    isBlockedOpsChecklistPattern,
  });

  const executeScheduledTaskApi = createExecuteScheduledTask({
    sendScheduledChecklist,
    sendSafetyCheck,
    refreshOpsAgentRuntimeConfig,
    buildScheduledTasksFromConfig,
    isBlockedOpsChecklistPattern,
    getOpsAgentConfig,
    scheduledTaskRuntimeStatus: scheduledTaskRuntimeApi.scheduledTaskRuntimeStatus,
  });

  const sendSafetyCheckApi = createSendSafetyCheck({
    getSharedState,
    isLikelySameStore,
    normalizeStoreKey,
    lookupFeishuUserByUsername,
    sendLarkCard,
    sendLarkMessage,
    prefixWithAgentName,
    opsTaskReplyAuditLarkMd,
  });

  const fetchStoreRatingForProfileDisplay = createFetchStoreRatingForProfileDisplay({
    pool,
    resolveAgentCanonicalStore,
    dailyReportIlikePatterns,
    feishuStoreSearchPatterns,
  });

  const runChiefEvaluator = createRunChiefEvaluator({
    pool,
    getSharedState,
    getStoresFromState,
    resolveBrandContextByStore,
    inferBrandFromStoreName,
    getBrandRuntimeConfig,
    calculateStoreRating,
    calculateEmployeeScore,
    callLLM,
  });

  const sendScheduledChecklistApi = createSendScheduledChecklist({
    pool,
    getSharedState,
    isLikelySameStore,
    normalizeStoreKey,
    lookupFeishuUserByUsername,
    sendLarkCard,
    formatChecklistTypeLabel,
    getOpsChecklistItems,
    opsTaskReplyAuditLarkMd,
    shouldSkipHrmsScheduledChecklist,
  });

  return {
    scheduledTaskRuntimeApi,
    buildScheduledTasksFromConfig: buildScheduledTasksFromConfigApi,
    executeScheduledTask: executeScheduledTaskApi,
    sendSafetyCheck: sendSafetyCheckApi,
    fetchStoreRatingForProfileDisplay,
    runChiefEvaluator,
    sendScheduledChecklist: sendScheduledChecklistApi,
  };
}
