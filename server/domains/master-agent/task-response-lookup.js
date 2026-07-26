/**
 * Lookup pending_response master_tasks for Feishu replies (P4 peel).
 */

const REPLY_KEYWORD_RE = /(已处理|已完成|已整改|已解决|处理完|整改完毕|情况说明|原因如下|马上处理|正在处理|立即处理)/;

export function hasTaskReplyKeyword(text) {
  return REPLY_KEYWORD_RE.test(String(text || '').trim());
}

/**
 * @param {{ query: Function }} pool
 * @param {{
 *   username: string,
 *   parentMessageId?: string|null,
 *   text?: string,
 *   imageUrls?: unknown[],
 *   tenantId?: string,
 *   log?: { info: Function },
 * }} opts
 */
export async function findPendingResponseTask(pool, opts) {
  const {
    username,
    parentMessageId = null,
    text = '',
    imageUrls = [],
    tenantId = 'default',
    log,
  } = opts;

  let task = null;

  if (parentMessageId) {
    const r = await pool.query(
      `SELECT * FROM master_tasks
       WHERE assignee_username = $1 AND status = 'pending_response'
       AND feishu_msg_ids ? $2
       AND tenant_id = $3
       ORDER BY dispatched_at ASC LIMIT 1`,
      [username, parentMessageId, tenantId]
    );
    task = r.rows?.[0];
    log?.info?.(`[master] Task lookup by parent_message_id: ${parentMessageId}, found: ${task?.task_id || 'none'}`);
  }

  if (!task && parentMessageId) {
    const r = await pool.query(
      `SELECT * FROM master_tasks
       WHERE assignee_username = $1 AND status = 'pending_response'
       AND tenant_id = $2
       ORDER BY dispatched_at DESC LIMIT 1`,
      [username, tenantId]
    );
    task = r.rows?.[0];
    log?.info?.(`[master] Task lookup fallback (has parent_id): found: ${task?.task_id || 'none'}`);
  }

  if (!task && !parentMessageId) {
    const images = Array.isArray(imageUrls) ? imageUrls : [];
    if (hasTaskReplyKeyword(text) || images.length > 0) {
      const r = await pool.query(
        `SELECT * FROM master_tasks
         WHERE assignee_username = $1 AND status = 'pending_response'
         AND tenant_id = $2
         ORDER BY dispatched_at DESC LIMIT 1`,
        [username, tenantId]
      );
      task = r.rows?.[0];
      log?.info?.(`[master] Task lookup by keyword/image: found: ${task?.task_id || 'none'}`);
    }
  }

  return task || null;
}

export function buildTaskResponseAck(task, text, imageUrls) {
  const images = Array.isArray(imageUrls) ? imageUrls : [];
  const body = String(text || '');
  return {
    handled: true,
    taskId: task.task_id,
    response: `✅ 已收到您对任务 [${task.task_id}] 的回复，正在审核中...\n\n📋 任务：${task.title}\n💬 您的回复：${body.slice(0, 100)}${body.length > 100 ? '...' : ''}\n📸 附件照片：${images.length}张\n\n请等待审核结果通知。`,
  };
}
