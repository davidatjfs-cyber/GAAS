/**
 * getOpsKnowledgeSupport factory (P2 peel from agents.js).
 */
import { getOpsKnowledgeSupportBody } from './knowledge-support-helpers.js';

/**
 * @param {object} deps
 * @returns {(query: string, context?: object) => Promise<object>}
 */
export function createGetOpsKnowledgeSupport(deps) {
  return (query, context = {}) => getOpsKnowledgeSupportBody(deps, query, context);
}
