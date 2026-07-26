/**
 * Feishu task response handler (P4 peel from master-agent.js).
 */
import {
  buildTaskResponseAck,
  findPendingResponseTask,
} from './task-response-lookup.js';

/**
 * @param {{
 *   pool: () => { query: Function },
 *   log: { info: Function, error: Function },
 *   transitionTask: Function,
 * }} deps
 */
export function createHandleTaskResponse(deps) {
  const { pool, log, transitionTask } = deps;

  return async function handleTaskResponse(username, text, imageUrls, parentMessageId = null) {
    try {
      const task = await findPendingResponseTask(pool(), {
        username,
        parentMessageId,
        text,
        imageUrls,
        tenantId: 'default',
        log,
      });
      if (!task) return null;

      const updated = await transitionTask(task.task_id, 'pending_review', 'master', {
        response_text: text || '',
        response_images: Array.isArray(imageUrls) ? imageUrls : [],
        parent_message_id: parentMessageId,
      }, 'default');

      if (updated) {
        log.info(`[master] Task ${task.task_id} response received from ${username} via reply`);
        return buildTaskResponseAck(task, text, imageUrls);
      }
      return null;
    } catch (e) {
      log.error('[master] handleTaskResponse error:', e?.message);
      return null;
    }
  };
}
