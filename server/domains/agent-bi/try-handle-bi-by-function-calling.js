/**
 * BI function-calling path (Wave A4a peel from agents.js tryHandleBiByFunctionCalling).
 * Intent planning / tool exec / narrate stay injected from agents.js.
 */
import { childLogger } from '../../utils/logger.js';
import { tryHandleBiByFunctionCallingBody } from './try-handle-bi-fc-helpers.js';

const log = childLogger({ domain: 'agent-bi', handler: 'try-handle-bi-fc' });

/** Per-user last tool context for follow-up turns. */
const _biLastToolCtx = new Map();

/** @internal test helper */
export function _resetBiLastToolCtxForTests() {
  _biLastToolCtx.clear();
}

/**
 * @param {object} deps
 * @returns {(args: object) => Promise<object|null>}
 */
export function createTryHandleBiByFunctionCalling(deps) {
  const mergedDeps = {
    ...deps,
    log,
    getBiLastToolCtx: (userId) => _biLastToolCtx.get(userId),
    setBiLastToolCtx: (userId, ctx) => _biLastToolCtx.set(userId, ctx),
  };
  return async function tryHandleBiByFunctionCalling(args) {
    return tryHandleBiByFunctionCallingBody(mergedDeps, args);
  };
}
