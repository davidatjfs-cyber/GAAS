/**
 * Agent long-memory / quality audit / autonomous data-task factory (P2 peel from agents.js).
 */
import {
  buildAutonomousTaskFingerprintBody,
  createAgentQualityMetricsState,
  markQualityMetricBody,
} from './agent-quality-autonomy-helpers.js';
import {
  createOrUpdateAutonomousDataTaskBody,
  getAgentLongMemoryBody,
  notifyAutonomousDataTaskOwnerBody,
  recordAgentQualityAuditBody,
  setAgentLongMemoryBody,
} from './agent-quality-autonomy-io.js';

/**
 * @param {object} deps
 */
export function createAgentQualityAutonomyApi(deps) {
  const metrics = createAgentQualityMetricsState();

  return {
    markQualityMetric: (field, delta = 1) => markQualityMetricBody(metrics, field, delta),
    getAgentQualityMetrics: () => ({ ...metrics }),
    getAgentLongMemory: (userKey, memoryKey) => getAgentLongMemoryBody(deps, userKey, memoryKey),
    setAgentLongMemory: (userKey, memoryKey, value) => setAgentLongMemoryBody(deps, userKey, memoryKey, value),
    recordAgentQualityAudit: (args) => recordAgentQualityAuditBody(deps, args),
    buildAutonomousTaskFingerprint: (args) => buildAutonomousTaskFingerprintBody(args, {
      normalizeStoreKey: deps.normalizeStoreKey,
      normalizePlainText: deps.normalizePlainText,
    }),
    createOrUpdateAutonomousDataTask: (args) => createOrUpdateAutonomousDataTaskBody(deps, metrics, args),
    notifyAutonomousDataTaskOwner: (task) => notifyAutonomousDataTaskOwnerBody(deps, task),
  };
}
