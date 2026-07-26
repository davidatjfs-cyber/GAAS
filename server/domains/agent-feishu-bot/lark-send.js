/**
 * Feishu IM send / register factory (P2 peel from agents.js).
 */
import { buildAlertCard, sanitizePerformanceZhText } from './lark-send-helpers.js';
import {
  getLarkImageUrlBody,
  registerFeishuUserBody,
  sendLarkCardBody,
  sendLarkMessageBody,
} from './lark-send-io.js';

/**
 * @param {object} deps
 */
export function createLarkSendApi(deps) {
  const feishuOpenIdResolveDeps =
    deps.feishuOpenIdResolveDeps ||
    (() => ({
      query: (sql, params) => deps.pool().query(sql, params),
      warn: (...args) => deps.log.warn(...args),
      info: (...args) => deps.log.info(...args),
    }));
  const bound = { ...deps, feishuOpenIdResolveDeps };

  return {
    sanitizePerformanceZhText,
    buildAlertCard,
    sendLarkMessage: (openId, text, options) => sendLarkMessageBody(bound, openId, text, options),
    sendLarkCard: (openId, card, options) => sendLarkCardBody(bound, openId, card, options),
    getLarkImageUrl: (messageId, imageKey) => getLarkImageUrlBody(bound, messageId, imageKey),
    registerFeishuUser: (openId, username) => registerFeishuUserBody(bound, openId, username),
  };
}
