/**
 * Text LLM client (P2 peel from agents.js callLLM).
 */
import { childLogger } from '../../utils/logger.js';
import { callLLMBody } from './call-llm-helpers.js';

const log = childLogger({ domain: 'ai', handler: 'call-llm' });

/**
 * @param {object} deps
 * @returns {(messages: unknown[], options?: object) => Promise<object>}
 */
export function createCallLLM(deps) {
  const merged = { ...deps, log };
  return async function callLLM(messages, options = {}) {
    return callLLMBody(merged, messages, options);
  };
}
