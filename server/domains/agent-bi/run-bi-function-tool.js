/**
 * BI function-tool runner (P2 peel from agents.js runBiFunctionTool).
 */
import { runBiFunctionToolBody } from './exec-bi-tools-helpers.js';

/**
 * @param {object} deps
 * @param {() => object} deps.pool
 * @param {(store: string) => string} deps.normalizeStoreLike
 * @param {(d: Date|string) => string} deps.formatDate
 * @param {(db: object, row: object) => Promise<unknown>} deps.logAgentOperation
 * @param {() => string} deps.getBadReviewTableId
 * @param {Function} deps.normalizeBitableDateValue
 * @param {Function} deps.extractBitableFieldText
 * @param {Function} deps.isLikelySameStore
 * @param {Function} deps.inDateRangeInclusive
 * @param {Function} deps.loadUnifiedTableVisitRowsByStore
 * @returns {(toolName: string, store: string, args?: object, originalQuery?: string, ctx?: object) => Promise<object>}
 */
export function createRunBiFunctionTool(deps) {
  return async function runBiFunctionTool(toolName, store, args = {}, originalQuery = '', ctx = {}) {
    return runBiFunctionToolBody(deps, toolName, store, args, originalQuery, ctx);
  };
}
