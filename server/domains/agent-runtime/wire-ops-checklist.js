/**
 * Ops checklist cards / capture-in-chat / overdue follow-up / card-action wiring
 * (P17 peel from agents.js bottom `createXxx` wiring cluster).
 */
import { createOpsChecklistCardsApi } from '../agent-ops/checklist-cards.js';
import { createTryCaptureOpsChecklistDetailFromChat } from '../agent-ops/capture-checklist-detail.js';
import { createFollowUpOverdueTasks } from '../agent-ops/follow-up-overdue-tasks.js';
import { createHandleOpsChecklistCardAction } from '../agent-ops/handle-checklist-card-action.js';

/**
 * @param {object} deps
 */
export function wireOpsChecklist(deps) {
  const {
    getOpsAgentConfig,
    countOpsChecklistAbnormal,
    sendLarkMessage,
    prefixWithAgentName,
    pool,
    log,
    lookupFeishuUser,
    sendLarkCard,
    getSharedState,
    resolveBrandContextByStore,
    getOpsChecklistProgressKey,
    getOpsChecklistItems,
    buildOpsChecklistAbnormalItemsCard,
    formatChecklistTypeLabel,
    resolveTenantIdDefault,
  } = deps;

  const opsChecklistCardsApi = createOpsChecklistCardsApi({ getOpsAgentConfig });
  const opsChecklistProgress = opsChecklistCardsApi.opsChecklistProgress;

  const tryCaptureOpsChecklistDetailFromChat = createTryCaptureOpsChecklistDetailFromChat({
    opsChecklistProgress,
    countOpsChecklistAbnormal,
    sendLarkMessage,
    prefixWithAgentName,
  });

  const followUpOverdueTasks = createFollowUpOverdueTasks({
    pool,
    getOpsAgentConfig,
    sendLarkMessage,
    prefixWithAgentName,
    log,
  });

  const handleOpsChecklistCardAction = createHandleOpsChecklistCardAction({
    pool,
    lookupFeishuUser,
    sendLarkMessage,
    sendLarkCard,
    getSharedState,
    resolveBrandContextByStore,
    getOpsChecklistProgressKey,
    getOpsChecklistItems,
    opsChecklistProgress,
    buildOpsChecklistAbnormalItemsCard,
    prefixWithAgentName,
    formatChecklistTypeLabel,
    countOpsChecklistAbnormal,
    resolveTenantIdDefault,
  });

  return {
    opsChecklistCardsApi,
    opsChecklistProgress,
    tryCaptureOpsChecklistDetailFromChat,
    followUpOverdueTasks,
    handleOpsChecklistCardAction,
  };
}
