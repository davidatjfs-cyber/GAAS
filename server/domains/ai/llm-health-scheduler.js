/**
 * LLM health probes + consecutive-error alerts + agent scheduler bootstrap (P2 peel from agents.js).
 */
import {
  buildLlmHealthProviders,
  createErrorTrackerState,
  createLlmHealthState,
} from './llm-health-scheduler-helpers.js';
import {
  sendErrorAlertToAdminBody,
  verifyLLMHealthBody,
} from './llm-health-scheduler-io.js';
import {
  runAuditTick,
  runWeeklyAuditTick,
  runEvalTick,
  runWeeklyOpsTick,
  runDailyRechargeTick,
  runPushTick,
} from '../agent-ops/scheduler-ticks.js';

/**
 * @param {object} deps
 */
export function createLlmHealthSchedulerApi(deps) {
  const {
    isExternalEnabled,
    axios,
    markProviderOk,
    markProviderFail,
    getSharedState,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    getScheduledTaskStatus,
    getPerformanceMetrics,
    pool,
    tenantContext,
    getActiveTenantIds,
    runDataAuditor,
    pushIssuesToFeishu,
    pushIssueToAssignee,
    pushScoresToFeishu,
    log,
    providerConfig,
    setTimeoutFn = setTimeout,
    setIntervalFn = setInterval,
    env = process.env,
  } = deps;

  let schedulerStarted = false;
  const errorTracker = createErrorTrackerState();
  const llmHealthState = createLlmHealthState();

  const buildProviders = () => buildLlmHealthProviders({
    deepseekModel: providerConfig.deepseekModel,
    deepseekApiKey: providerConfig.deepseekApiKey,
    deepseekBaseUrl: providerConfig.deepseekBaseUrl,
    qwenModel: providerConfig.qwenModel,
    qwenApiKey: providerConfig.qwenApiKey,
    qwenBaseUrl: providerConfig.qwenBaseUrl,
    doubaoModel: providerConfig.doubaoModel,
    doubaoApiKey: providerConfig.doubaoApiKey,
    doubaoBaseUrl: providerConfig.doubaoBaseUrl,
  });

  const ioDeps = {
    isExternalEnabled,
    axios,
    markProviderOk,
    markProviderFail,
    buildProviders,
    getSharedState,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    log,
  };

  async function sendErrorAlertToAdmin(errorMsg) {
    return sendErrorAlertToAdminBody(ioDeps, errorTracker, errorMsg);
  }

  async function verifyLLMHealth(options = {}) {
    return verifyLLMHealthBody({ ...ioDeps, sendErrorAlertToAdmin }, llmHealthState, options);
  }

  function trackLLMResult(ok) {
    if (ok) {
      errorTracker.consecutiveLLMErrors = 0;
      return;
    }
    errorTracker.consecutiveLLMErrors++;
    if (errorTracker.consecutiveLLMErrors >= 5) {
      void sendErrorAlertToAdmin(
        `LLM 连续调用失败 ${errorTracker.consecutiveLLMErrors} 次，Agent 可能无法正常回复。\n\n` +
        `说明：厂商控制台「账号正常」不等于 ECS 上 hrms-service 能调通 API（密钥、模型名、出网、429/欠费均会导致失败）。\n` +
        `健康检查会测 DeepSeek、通义(Qwen)、豆包(Vision) 三条链路，任一条失败都会计入。\n\n` +
        `请 SSH 到服务器执行：pm2 logs hrms-service --lines 80\n搜索 [LLM-FALLBACK]、401、429、timeout 定位具体 Provider。`
      );
    }
  }

  function getAgentHealthStatus() {
    const schedulingDelegated = env.DISABLE_AGENT_SCHEDULING === 'true';
    return {
      schedulerRunning: schedulerStarted,
      schedulingDelegated,
      consecutiveLLMErrors: errorTracker.consecutiveLLMErrors,
      performanceMetrics: { ...(getPerformanceMetrics?.() || {}) },
      llmHealthy: errorTracker.consecutiveLLMErrors < 5,
      scheduledTaskStatus: getScheduledTaskStatus(),
    };
  }

  function startAgentScheduler() {
    if (schedulerStarted) return;
    schedulerStarted = true;

    setTimeoutFn(() => {
      verifyLLMHealth({ notifyOnFailure: true, notifyOnRecovery: true }).catch((e) => {
        log.error('[LLM-HEALTH] periodic check error:', e?.message);
      });
    }, 30000);
    setIntervalFn(() => {
      verifyLLMHealth({ notifyOnFailure: true, notifyOnRecovery: true }).catch((e) => {
        log.error('[LLM-HEALTH] periodic check error:', e?.message);
      });
    }, 10 * 60 * 1000);

    const tickDeps = {
      pool,
      tenantContext,
      getActiveTenantIds,
      runDataAuditor,
      pushIssuesToFeishu,
      pushIssueToAssignee,
      pushScoresToFeishu,
      log,
    };
    const auditTick = () => runAuditTick(tickDeps);
    const weeklyAuditTick = () => runWeeklyAuditTick(tickDeps);
    const evalTick = () => runEvalTick(tickDeps);
    const weeklyOpsTick = () => runWeeklyOpsTick(tickDeps);
    const dailyRechargeTick = () => runDailyRechargeTick(tickDeps);
    const pushTick = () => runPushTick(tickDeps);

    setTimeoutFn(auditTick, 15000);
    setIntervalFn(auditTick, 30 * 60 * 1000);
    setIntervalFn(weeklyAuditTick, 30 * 60 * 1000);
    setIntervalFn(evalTick, 60 * 60 * 1000);
    setIntervalFn(weeklyOpsTick, 60 * 60 * 1000);
    setIntervalFn(dailyRechargeTick, 60 * 60 * 1000);
    setIntervalFn(pushTick, 5 * 60 * 1000);
  }

  return {
    verifyLLMHealth,
    trackLLMResult,
    getAgentHealthStatus,
    startAgentScheduler,
    sendErrorAlertToAdmin,
  };
}
