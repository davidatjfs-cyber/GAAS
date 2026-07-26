import { tenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { blockInactiveFeishuEmployee } from './on-feishu-event-employee.js';
import { handleUnregisteredFeishuUser } from './on-feishu-event-registration.js';
import { extractFeishuMessageContent } from './on-feishu-event-message-content.js';
import { sendOpsChecklistBitableForm } from './on-feishu-event-checklist.js';
import {
  insertInboundFeishuAgentMessage,
  routeAndHandleFeishuAgentMessage,
  tryFeishuTaskResponse,
} from './on-feishu-event-agent-route.js';

const log = childLogger({ domain: 'agent-feishu-bot', handler: 'on-feishu-event-im-message' });

/**
 * @param {object} deps
 * @param {{ openId: string, feishuUser: object, msg: object, msgType: string, messageId: string, parentMessageId: string, rootMessageId: string }} ctx
 */
export async function processRegisteredFeishuMessage(deps, ctx) {
  const {
    openId,
    feishuUser,
    msg,
    msgType,
    messageId,
    parentMessageId,
    rootMessageId,
  } = ctx;
  const {
    tryFeishuMarketingCopyRound,
    tryCaptureOpsChecklistDetailFromChat,
    detectOpsChecklistType,
  } = deps;

  const { text, imageUrls, earlyReturn } = await extractFeishuMessageContent(deps, {
    msg,
    msgType,
    messageId,
    openId,
  });
  if (earlyReturn) return earlyReturn;

  const mcRound = await tryFeishuMarketingCopyRound({
    openId,
    feishuUser,
    text,
    imageUrls,
  });
  if (mcRound?.handled) return mcRound.body;

  if (!text && !imageUrls.length) return { ok: true, skipped: 'empty' };

  const detailCapture = await tryCaptureOpsChecklistDetailFromChat(
    openId,
    feishuUser,
    text,
    imageUrls
  );
  if (detailCapture?.handled) {
    return { ok: true, route: 'ops_supervisor', checklistDetailCaptured: true };
  }

  const checklistType = detectOpsChecklistType(text);
  const checklistResult = await sendOpsChecklistBitableForm(deps, {
    openId,
    feishuUser,
    text,
    msgType,
    checklistType,
  });
  if (checklistResult) return checklistResult;

  const msgDbId = await insertInboundFeishuAgentMessage(deps, {
    openId,
    feishuUser,
    messageId,
    text,
    imageUrls,
  });

  const taskResult = await tryFeishuTaskResponse(deps, {
    openId,
    feishuUser,
    text,
    imageUrls,
    parentMessageId,
    rootMessageId,
    msgDbId,
    msg,
  });
  if (taskResult) return taskResult;

  return routeAndHandleFeishuAgentMessage(deps, {
    openId,
    feishuUser,
    text,
    imageUrls,
    msgDbId,
  });
}

/**
 * @param {object} deps
 * @param {{ event: object }} ctx
 */
export async function handleImMessageReceiveV1(deps, { event }) {
  const { lookupFeishuUser } = deps;
  const msg = event?.message || {};
  const sender = event?.sender || {};
  const msgType = String(msg?.message_type || '').trim();
  const messageId = String(msg?.message_id || '').trim();
  const parentMessageId = String(msg?.parent_id || msg?.parent_message_id || '').trim();
  const rootMessageId = String(msg?.root_id || msg?.root_message_id || '').trim();
  const chatType = String(msg?.chat_type || '').trim();
  const openId = String(sender?.sender_id?.open_id || '').trim();

  if (!openId) return { ok: true, skipped: 'no_sender' };
  if (chatType !== 'private' && chatType !== 'p2p') {
    log.info({ msg: 'skip_non_private', chat_type: chatType });
    return { ok: true, skipped: 'not_private' };
  }

  let feishuUser = await lookupFeishuUser(openId);

  if (!feishuUser || !feishuUser.registered) {
    const reg = await handleUnregisteredFeishuUser(deps, {
      openId,
      msg,
      msgType,
      existingUser: feishuUser,
    });
    if (reg.result) return reg.result;
    feishuUser = reg.feishuUser;
  }

  const blocked = await blockInactiveFeishuEmployee(deps, { openId, feishuUser });
  if (blocked) return blocked;

  return tenantContext.run(feishuUser.tenant_id || 'default', () =>
    processRegisteredFeishuMessage(deps, {
      openId,
      feishuUser,
      msg,
      msgType,
      messageId,
      parentMessageId,
      rootMessageId,
    })
  );
}
