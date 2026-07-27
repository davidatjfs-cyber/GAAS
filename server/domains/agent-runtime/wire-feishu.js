/**
 * Feishu marketing-copy round / issue push / user-messaging / period-reports / webhook wiring
 * (P17 peel from agents.js bottom `createXxx` wiring cluster).
 */
import { createTryFeishuMarketingCopyRound } from '../agent-message/marketing-copy.js';
import { createPushIssuesToFeishu } from '../agent-feishu-bot/push-issues.js';
import { createFeishuUserMessagingApi } from '../agent-feishu-bot/feishu-user-messaging.js';
import { createSendPeriodReportsApi } from '../agent-bi/send-period-reports.js';
import { createOnFeishuEvent } from '../agent-feishu-bot/on-feishu-event.js';

/**
 * @param {object} deps
 */
export function wireFeishu(deps) {
  const {
    callLLM,
    callVisionLLM,
    sendLarkMessage,
    prefixWithAgentName,
    log,
    pool,
    lookupFeishuUserByUsername,
    sendLarkCard,
    resolveTenantIdDefault,
    getLarkTenantToken,
    axios,
    tenantContext,
    getActiveTenantIds,
    getSharedState,
    registerFeishuUser,
    agentPool,
    reportStoresSeed,
    generateWeeklyReport,
    generateMonthlyReport,
    formatReportMarkdown,
    calendarLastCompletedWeekMonSunShanghai,
    calendarPreviousMonthRangeShanghai,
    resolveAgentCanonicalStore,
    dailyReportIlikePatterns,
    lookupFeishuUser,
    tryAutoBindByName,
    getLarkImageUrl,
    recognizeLarkAudio,
    resolveBrandContextByStore,
    routeMessage,
    checkAgentPermission,
    handleAgentMessage,
    handleOpsChecklistCardAction,
    tryCaptureOpsChecklistDetailFromChat,
    detectOpsChecklistType,
    getTaskResponseHook,
  } = deps;

  const tryFeishuMarketingCopyRound = createTryFeishuMarketingCopyRound({
    callLLM,
    callVisionLLM,
    sendLarkMessage,
    prefixWithAgentName,
    log,
  });

  const pushIssuesToFeishu = createPushIssuesToFeishu({
    pool,
    lookupFeishuUserByUsername,
    sendLarkCard,
    sendLarkMessage,
    prefixWithAgentName,
    resolveTenantIdDefault,
    log,
  });

  const feishuUserMessagingApi = createFeishuUserMessagingApi({
    getLarkTenantToken,
    axios,
    pool,
    tenantContext,
    getActiveTenantIds,
    getSharedState,
    registerFeishuUser,
    sendLarkMessage,
    log,
  });

  const sendPeriodReportsApi = createSendPeriodReportsApi({
    agentPool,
    pool,
    reportStoresSeed,
    getSharedState,
    lookupFeishuUserByUsername,
    sendLarkCard,
    sendLarkMessage,
    prefixWithAgentName,
    generateWeeklyReport,
    generateMonthlyReport,
    formatReportMarkdown,
    calendarLastCompletedWeekMonSunShanghai,
    calendarPreviousMonthRangeShanghai,
    resolveAgentCanonicalStore,
    dailyReportIlikePatterns,
    log,
  });

  const onFeishuEvent = createOnFeishuEvent({
    pool,
    lookupFeishuUser,
    tryAutoBindByName,
    registerFeishuUser,
    sendLarkMessage,
    sendLarkCard,
    getLarkImageUrl,
    recognizeLarkAudio,
    getSharedState,
    resolveBrandContextByStore,
    routeMessage,
    checkAgentPermission,
    prefixWithAgentName,
    handleAgentMessage,
    handleOpsChecklistCardAction,
    tryCaptureOpsChecklistDetailFromChat,
    tryFeishuMarketingCopyRound,
    detectOpsChecklistType,
    getTaskResponseHook,
  });

  return { tryFeishuMarketingCopyRound, pushIssuesToFeishu, feishuUserMessagingApi, sendPeriodReportsApi, onFeishuEvent };
}
