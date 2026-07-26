/**
 * Follow up overdue master_tasks via Feishu (P2 peel from agents.js).
 */

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {() => object} deps.getOpsAgentConfig
 * @param {Function} deps.sendLarkMessage
 * @param {Function} deps.prefixWithAgentName
 * @param {{ error: Function }} deps.log
 */
export function createFollowUpOverdueTasks(deps) {
  const { pool, getOpsAgentConfig, sendLarkMessage, prefixWithAgentName, log } = deps;

  return async function followUpOverdueTasks() {
    const config = getOpsAgentConfig().loopManagement.followUpRules;
    const now = new Date();
    const followUps = [];

    try {
      const unreadTasks = await pool().query(
        `
      SELECT t.*, u.open_id, u.name
      FROM master_tasks t
      JOIN users u ON t.assignee_username = u.username
      WHERE t.status = 'dispatched' 
        AND t.created_at < NOW() - make_interval(mins => $2)
        AND t.reminder_count < $1
    `,
        [config.maxReminders, Math.max(1, Math.floor(Number(config.firstReminder) || 60))]
      );

      for (const task of unreadTasks.rows) {
        const reminderMsg = prefixWithAgentName(
          'ops_supervisor',
          `【任务提醒】${task.assignee_username}，你有任务已超时${Math.round((now - new Date(task.created_at)) / 60000)}分钟未查看，请及时处理：${task.title}`
        );

        try {
          await sendLarkMessage(task.open_id, reminderMsg);

          await pool().query(
            `
          UPDATE master_tasks 
          SET reminder_count = reminder_count + 1, 
              last_reminded_at = NOW()
          WHERE id = $1
        `,
            [task.id]
          );

          followUps.push({
            taskId: task.id,
            type: 'unread_reminder',
            assignee: task.assignee_username,
            reminderCount: task.reminder_count + 1,
          });
        } catch (e) {
          log.error('[ops_supervisor] follow-up failed:', e?.message);
        }
      }
    } catch (e) {
      log.error('[ops_supervisor] overdue tasks check failed:', e?.message);
    }

    return followUps;
  };
}
