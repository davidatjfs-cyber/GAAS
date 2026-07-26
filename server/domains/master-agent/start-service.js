/**
 * startMasterAgent orchestration (P4 peel from master-agent.js).
 */
import {
  createTenantScopedTick,
  registerMasterIntervals,
} from './scheduler.js';
import { createMasterListeners } from './listeners-service.js';
import { seedTaskIdSequence } from './task-lifecycle.js';
import {
  buildAuditTick,
  buildDispatchTick,
  buildMasterIntervalSchedule,
} from './start-ticks.js';

/**
 * @param {object} deps
 * @returns {() => void}
 */
export function createStartMasterAgent(deps) {
  const {
    pool,
    log,
    getActiveTenantIds,
    tenantContext,
    transitionTask,
    sendLarkCard,
    sendLarkMessage,
    lookupFeishuUserByUsername,
    writeTaskToBitable,
    getTaskResponseFormUrl,
    buildTaskDispatchCard,
    callLLM,
    callVisionLLM,
    queryKnowledgeBase,
    prefixWithAgentName,
    resolveAssignee,
    getSharedState,
    runDataAuditor,
    syncDataAuditorIssuesToMasterTasks,
    AgentCommunicationSystem,
    pollTaskResponseBitable,
    refreshEntityHealthSnapshots,
    inspectionClosedLoopTick,
    biProactivePushTick,
    laborEfficiencyTick,
    trainingClosedLoopTick,
  } = deps;

  let masterStarted = false;

  return function startMasterAgent() {
    if (masterStarted) return;
    masterStarted = true;
    log.info('[master] Starting event-driven orchestration...');

    (async () => {
      try {
        const r = await pool().query(`SELECT MAX(id) as maxid FROM master_tasks`);
        seedTaskIdSequence(r.rows?.[0]?.maxid || 0);
      } catch (_e) { /* ignore */ }
    })();

    const tenantTick = createTenantScopedTick({
      pool,
      getActiveTenantIds,
      tenantContext,
      log,
    });

    const {
      dataAuditorListener,
      masterDispatcher,
      opsAgentListener,
      masterPostResolution,
      masterHandleRejected,
      chiefEvaluatorListener,
      masterFinalNotification,
      trainAgentListener,
      masterIssuesListener,
      masterOptimizationCoordinator,
      trainTaskDispatcher,
    } = createMasterListeners({
      pool,
      log,
      transitionTask,
      sendLarkCard,
      sendLarkMessage,
      lookupFeishuUserByUsername,
      writeTaskToBitable,
      getTaskResponseFormUrl,
      buildTaskDispatchCard,
      callLLM,
      callVisionLLM,
      queryKnowledgeBase,
      prefixWithAgentName,
      resolveAssignee,
      getSharedState,
      runDataAuditor,
      syncDataAuditorIssuesToMasterTasks,
      AgentCommunicationSystem,
    });

    const auditTick = buildAuditTick(tenantTick, {
      pool,
      dataAuditorListener,
      transitionTask,
      log,
    });
    const dispatchTick = buildDispatchTick(tenantTick, {
      pool,
      masterDispatcher,
    });

    const opsTick = tenantTick('Ops processed', (tenantId) => opsAgentListener(tenantId), {
      formatMessage: (n) => `${n} tasks`,
    });

    const postResTick = tenantTick('Post-resolution', async (tenantId) => {
      const resolved = await masterPostResolution(tenantId);
      const rejected = await masterHandleRejected(tenantId);
      if (rejected > 0) {
        log.info(`[master:tick] Re-dispatched rejected(${tenantId}): ${rejected}`);
      }
      return resolved;
    });

    const evalTick = tenantTick('Evaluator settled', (tenantId) => chiefEvaluatorListener(tenantId), {
      formatMessage: (n) => `${n} tasks`,
    });

    const finalTick = tenantTick('Closed', (tenantId) => masterFinalNotification(tenantId), {
      formatMessage: (n) => `${n} tasks`,
    });

    const trainTick = tenantTick('Train processed', (tenantId) => trainAgentListener(tenantId), {
      formatMessage: (n) => `${n} cases`,
    });

    const issuesTick = tenantTick('Issues coordinator processed', (tenantId) => masterIssuesListener(tenantId), {
      formatMessage: (n) => `${n} issues`,
    });

    const optimizationTick = tenantTick('Optimization coordinator processed', (tenantId) => masterOptimizationCoordinator(tenantId), {
      formatMessage: (n) => `${n} proposals`,
    });

    const trainDispatchTick = tenantTick('Train task dispatcher sent', (tenantId) => trainTaskDispatcher(tenantId), {
      formatMessage: (n) => `${n} tasks`,
    });

    const taskResponseTick = async () => {
      try {
        await pollTaskResponseBitable();
      } catch (e) {
        log.error('[master:tick] task response poll error:', e?.message);
      }
    };

    const kgHealthTick = tenantTick('KG health snapshots refreshed for', (tenantId) => refreshEntityHealthSnapshots(tenantId), {
      formatMessage: (n) => `${n} stores`,
    });

    const inspectionLoopTick = tenantTick('Inspection closed loop', (tenantId) => inspectionClosedLoopTick(tenantId), {
      formatMessage: (n) => `${n} actions`,
    });

    const biPushTick = tenantTick('BI proactive push', (tenantId) => biProactivePushTick(tenantId), {
      formatMessage: (n) => `${n} alerts`,
    });

    const laborTick = tenantTick('Labor efficiency', (tenantId) => laborEfficiencyTick(tenantId), {
      formatMessage: (n) => `${n} suggestions`,
    });

    const trainingLoopTick = tenantTick('Training closed loop', (tenantId) => trainingClosedLoopTick(tenantId), {
      formatMessage: (n) => `${n} tasks created`,
    });

    registerMasterIntervals(buildMasterIntervalSchedule({
      auditTick,
      dispatchTick,
      opsTick,
      postResTick,
      evalTick,
      finalTick,
      trainTick,
      issuesTick,
      trainDispatchTick,
      optimizationTick,
      taskResponseTick,
      kgHealthTick,
      inspectionLoopTick,
      biPushTick,
      laborTick,
      trainingLoopTick,
    }), log);
  };
}
