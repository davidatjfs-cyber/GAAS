/**
 * Master-agent listener wiring — thin factory for startMasterAgent ticks.
 */
import { createOpsAgentListener } from './ops-listener.js';
import { createTrainAgentListener } from './train-listener.js';
import {
  chiefEvaluatorListener,
  dataAuditorListener,
  masterDispatcher,
  masterFinalNotification,
  masterHandleRejected,
  masterIssuesListener,
  masterOptimizationCoordinator,
  masterPostResolution,
  trainTaskDispatcher,
} from './master-listeners.js';

function bind(deps, fn) {
  return (tenantId) => fn(deps, tenantId);
}

export function createMasterListeners(deps) {
  return {
    opsAgentListener: createOpsAgentListener(deps),
    trainAgentListener: createTrainAgentListener(deps),
    dataAuditorListener: bind(deps, dataAuditorListener),
    masterIssuesListener: bind(deps, masterIssuesListener),
    masterOptimizationCoordinator: bind(deps, masterOptimizationCoordinator),
    masterDispatcher: bind(deps, masterDispatcher),
    masterPostResolution: bind(deps, masterPostResolution),
    masterHandleRejected: bind(deps, masterHandleRejected),
    chiefEvaluatorListener: bind(deps, chiefEvaluatorListener),
    masterFinalNotification: bind(deps, masterFinalNotification),
    trainTaskDispatcher: bind(deps, trainTaskDispatcher),
  };
}
