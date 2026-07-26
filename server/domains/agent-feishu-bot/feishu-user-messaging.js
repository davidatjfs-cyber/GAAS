/**
 * Feishu ASR / user lookup / issue push factory (P2 peel from agents.js).
 */
import {
  getFeishuUserInfoBody,
  lookupFeishuUserBody,
  lookupFeishuUserByUsernameBody,
  pushIssueToAssigneeBody,
  recognizeLarkAudioBody,
  replyLarkMessageBody,
  tryAutoBindByNameBody,
} from './feishu-user-messaging-io.js';

/**
 * @param {object} deps
 */
export function createFeishuUserMessagingApi(deps) {
  return {
    recognizeLarkAudio: (messageId, fileKey) => recognizeLarkAudioBody(deps, messageId, fileKey),
    replyLarkMessage: (messageId, text) => replyLarkMessageBody(deps, messageId, text),
    lookupFeishuUser: (openId) => lookupFeishuUserBody(deps, openId),
    getFeishuUserInfo: (openId) => getFeishuUserInfoBody(deps, openId),
    tryAutoBindByName: (openId) => tryAutoBindByNameBody(deps, openId),
    lookupFeishuUserByUsername: (username) => lookupFeishuUserByUsernameBody(deps, username),
    pushIssueToAssignee: (issue, message, tenantId) =>
      pushIssueToAssigneeBody(deps, issue, message, tenantId),
  };
}
