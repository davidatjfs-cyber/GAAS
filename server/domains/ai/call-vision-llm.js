/**
 * Vision / video LLM clients (P2 peel from agents.js).
 */
import { childLogger } from '../../utils/logger.js';
import { callVisionLLMBody, callVisionLLMVideoBody } from './call-vision-llm-helpers.js';

const log = childLogger({ domain: 'ai', handler: 'call-vision-llm' });

/**
 * @param {object} deps
 * @returns {(imageUrl: unknown, prompt: string, opts?: object) => Promise<object>}
 */
export function createCallVisionLLM(deps) {
  const merged = { ...deps, log };
  return async function callVisionLLM(imageUrl, prompt, opts = {}) {
    return callVisionLLMBody(merged, imageUrl, prompt, opts);
  };
}

/**
 * @param {object} deps
 * @returns {(videoUrl: string, prompt: string, opts?: object) => Promise<object>}
 */
export function createCallVisionLLMVideo(deps) {
  const merged = { ...deps, log };
  return async function callVisionLLMVideo(videoUrl, prompt, opts = {}) {
    return callVisionLLMVideoBody(merged, videoUrl, prompt, opts);
  };
}
