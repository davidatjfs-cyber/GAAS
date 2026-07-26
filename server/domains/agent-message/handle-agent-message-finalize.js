import { setSessionState } from '../../data-executor.js';
import { childLogger } from '../../utils/logger.js';
import { applyPostRouteQualityGates } from './post-route-quality.js';
import { buildEvidencePackage, needsAutonomousDataTask } from './quality-helpers.js';

const log = childLogger({ domain: 'agent-message', handler: 'handle-agent-message-finalize' });

/**
 * Post-route quality gates, memory, session persistence, autonomous data-gap task.
 * @returns {{ route: string, response: string, agentData: object }}
 */
export async function finalizeAgentMessage(ctx, deps) {
  const {
    text,
    route,
    response: initialResponse,
    agentData: initialAgentData,
    senderUsername,
    senderRole,
    store,
    brand,
    sessionState,
  } = ctx;
  const {
    markQualityMetric,
    enforceUnifiedQualityGate,
    setAgentLongMemory,
    getSharedState,
    findStoreManager,
    createOrUpdateAutonomousDataTask,
    notifyAutonomousDataTaskOwner,
  } = deps;

  let response = initialResponse;
  let agentData = initialAgentData;

  {
    const postQ = await applyPostRouteQualityGates(
      { text, route, response, agentData, senderUsername, senderRole, store, brand },
      { markQualityMetric, enforceUnifiedQualityGate }
    );
    response = postQ.response;
    agentData = postQ.agentData;
  }
  const evidence = agentData?.evidence || buildEvidencePackage(agentData, { route, store, brand });

  try {
    await setAgentLongMemory(senderUsername, 'last_route', {
      route,
      store,
      brand,
      confidence: agentData.confidence,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    /* ignore */
  }

  try {
    if (agentData.metrics_returned?.length) {
      sessionState.metrics_returned = [
        ...new Set([...(sessionState.metrics_returned || []), ...agentData.metrics_returned]),
      ];
    }
    if (agentData.metric_versions) {
      sessionState.metric_versions = {
        ...(sessionState.metric_versions || {}),
        ...agentData.metric_versions,
      };
    }
    sessionState.route = route;
    sessionState.store = store || sessionState.store;
    await setSessionState(senderUsername, sessionState);
  } catch {
    /* ignore */
  }

  if (needsAutonomousDataTask(agentData) && store && store !== '总部') {
    try {
      const state = await getSharedState();
      const owner = await findStoreManager(state, store);
      const task = await createOrUpdateAutonomousDataTask({
        taskType: 'data_gap',
        store,
        brand,
        requesterUsername: senderUsername,
        route,
        queryText: text,
        reason: String(
          agentData?.reason ||
            (agentData?.factualGuardrailBlocked ? 'factual_guardrail_blocked' : 'insufficient_evidence')
        ).slice(0, 120),
        evidence,
        ownerUsername: owner || '',
        dueHours: 8,
      });
      if (task) {
        agentData.autonomousTaskId = task.id;
        notifyAutonomousDataTaskOwner(task).catch(() => {});
      }
    } catch (e) {
      log.error({ msg: 'autonomous_data_gap_task_failed', err: String(e?.message || e) });
    }
  }

  return { route, response, agentData };
}
