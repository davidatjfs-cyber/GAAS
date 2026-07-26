/**
 * Feishu marketing-copy factory (P2 peel from agents.js).
 */
import { tryFeishuMarketingCopyRoundBody } from './marketing-copy-io.js';

/**
 * @param {object} deps
 * @param {Function} deps.callLLM
 * @param {Function} deps.callVisionLLM
 * @param {Function} deps.sendLarkMessage
 * @param {Function} deps.prefixWithAgentName
 * @param {{ error: Function }} deps.log
 * @returns {(args: { openId: string, feishuUser: object, text?: string, imageUrls?: string[] }) => Promise<object|null>}
 */
export function createTryFeishuMarketingCopyRound(deps) {
  const sessions = new Map();
  return (args) => tryFeishuMarketingCopyRoundBody(deps, sessions, args);
}
