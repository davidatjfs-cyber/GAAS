import { resolveTenantIdDefault } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-feishu-bot', handler: 'on-feishu-event-task-response' });

function isLikelyTaskResponse(text, imageUrls, parentMessageId, rootMessageId) {
  const effectiveParentId = parentMessageId || rootMessageId || '';
  return (
    !!effectiveParentId ||
    imageUrls.length > 0 ||
    /^(TASK|OPS|BI|EVAL|MT)-/i.test(String(text || '').trim()) ||
    /(已处理|已完成|已整改|已解决|处理完|整改完毕|情况说明|原因如下|回复你|测试)/.test(
      String(text || '').trim()
    )
  );
}

/**
 * @param {object} deps
 * @param {{ openId: string, feishuUser: object, text: string, imageUrls: string[], parentMessageId: string, rootMessageId: string, msgDbId: number|null, msg: object }} ctx
 */
export async function tryFeishuTaskResponse(deps, ctx) {
  const {
    openId,
    feishuUser,
    text,
    imageUrls,
    parentMessageId,
    rootMessageId,
    msgDbId,
    msg,
  } = ctx;
  const { pool, sendLarkMessage, prefixWithAgentName, getTaskResponseHook } = deps;

  log.info({
    msg: 'task_reply_debug',
    parentMessageId,
    rootMessageId,
    text: String(text || '').slice(0, 60),
    msgKeys: Object.keys(msg),
  });

  const effectiveParentId = parentMessageId || rootMessageId || '';
  const taskResponseHook = typeof getTaskResponseHook === 'function' ? getTaskResponseHook() : null;
  if (!taskResponseHook || !isLikelyTaskResponse(text, imageUrls, parentMessageId, rootMessageId)) {
    return null;
  }

  try {
    const taskResult = await taskResponseHook(
      feishuUser.username,
      text,
      imageUrls,
      effectiveParentId
    );
    if (!taskResult?.handled) return null;

    const reply = prefixWithAgentName('master', taskResult.response);
    await sendLarkMessage(openId, reply);
    try {
      if (msgDbId) {
        await pool().query(
          `UPDATE agent_messages SET routed_to='master', agent_response=$1, agent_data=$2::jsonb WHERE id=$3`,
          [
            taskResult.response,
            JSON.stringify({ taskId: taskResult.taskId, route: 'master_task' }),
            msgDbId,
          ]
        );
      }
    } catch {
      /* feishu task response update */
    }
    return { ok: true, route: 'master', taskId: taskResult.taskId };
  } catch (e) {
    log.error({ msg: 'task_response_hook_error', err: String(e?.message || e) });
    return null;
  }
}

/**
 * @param {object} deps
 * @param {{ openId: string, feishuUser: object, messageId: string, text: string, imageUrls: string[] }} ctx
 * @returns {Promise<number|null>}
 */
export async function insertInboundFeishuAgentMessage(deps, ctx) {
  const { pool } = deps;
  const { openId, feishuUser, messageId, text, imageUrls } = ctx;

  try {
    const r = await pool().query(
      `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, sender_role, content_type, content, image_urls, feishu_message_id, tenant_id)
         VALUES ('in','feishu',$1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING id`,
      [
        openId,
        feishuUser.username,
        feishuUser.name,
        feishuUser.role,
        imageUrls.length ? 'image' : 'text',
        text || '',
        JSON.stringify(imageUrls),
        messageId,
        resolveTenantIdDefault(),
      ]
    );
    return r.rows?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

function isSlowRequest(text, imageUrls) {
  const t = String(text || '').trim();
  return (
    t.includes('行动计划') ||
    t.includes('健康度') ||
    t.includes('改善方案') ||
    t.includes('因果') ||
    t.includes('对比') ||
    t.includes('预估') ||
    t.includes('营业额') ||
    t.includes('毛利') ||
    t.includes('损耗') ||
    t.includes('差评') ||
    t.includes('绩效') ||
    t.includes('考核') ||
    imageUrls.length > 0
  );
}

/**
 * @param {object} deps
 * @param {{ openId: string, feishuUser: object, text: string, imageUrls: string[], msgDbId: number|null }} ctx
 */
export async function routeAndHandleFeishuAgentMessage(deps, ctx) {
  const { openId, feishuUser, text, imageUrls, msgDbId } = ctx;
  const {
    pool,
    getSharedState,
    resolveBrandContextByStore,
    routeMessage,
    checkAgentPermission,
    prefixWithAgentName,
    sendLarkMessage,
    handleAgentMessage,
  } = deps;

  const sharedState = await getSharedState();
  const brandContext = resolveBrandContextByStore(sharedState, feishuUser.store || '');

  const hasImg = Array.isArray(imageUrls) && imageUrls.length > 0;
  const preRoute = await routeMessage(text, hasImg, feishuUser.username);
  const userRole = String(feishuUser.role || '').trim();
  if (preRoute?.route && userRole) {
    const permCheck = checkAgentPermission(userRole, preRoute.route);
    if (!permCheck.allowed) {
      await sendLarkMessage(openId, `⚠️ ${permCheck.reason}`);
      return { ok: true, denied: true, route: preRoute.route, role: userRole };
    }
  }

  if (isSlowRequest(text, imageUrls)) {
    const loadingHint =
      imageUrls.length > 0 ? '📸 收到照片，正在审核中...' : '🔍 正在为您查询，请稍候...';
    sendLarkMessage(openId, loadingHint, { skipDedup: true }).catch(() => {});
  }

  const rawResult = await handleAgentMessage(
    feishuUser.username,
    feishuUser.name || feishuUser.username,
    feishuUser.store || '',
    feishuUser.role || '',
    brandContext,
    text,
    imageUrls
  );
  const result =
    rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
      ? rawResult
      : { route: 'general', response: String(rawResult || ''), agentData: {} };

  if (result.response) {
    await sendLarkMessage(openId, prefixWithAgentName(result.route, result.response), {
      skipDedup: true,
    });
  }

  try {
    if (msgDbId) {
      await pool().query(
        `UPDATE agent_messages SET routed_to=$1, agent_response=$2, agent_data=$3::jsonb WHERE id=$4`,
        [result.route, result.response, JSON.stringify(result.agentData || {}), msgDbId]
      );
    }
  } catch {
    /* ignore */
  }

  return { ok: true, route: result.route, responded: !!result.response };
}
