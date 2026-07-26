/**
 * Check Agent quality-gate factory (P2 peel from agents.js).
 */
import {
  enforceUnifiedQualityGateBody,
  runWithCheckAgentBody,
} from './check-agent-quality-io.js';

/**
 * @param {object} deps
 * @param {Function} deps.callLLM
 * @param {{ info: Function, error: Function }} deps.log
 * @param {Function} deps.markQualityMetric
 * @param {Function} deps.recordAgentQualityAudit
 */
export function createCheckAgentQualityApi(deps) {
  return {
    runWithCheckAgent: (userQuery, route, generateFn, maxRetries) =>
      runWithCheckAgentBody(deps, userQuery, route, generateFn, maxRetries),
    enforceUnifiedQualityGate: (args) => enforceUnifiedQualityGateBody(deps, args),
  };
}
