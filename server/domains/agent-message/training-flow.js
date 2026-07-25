/**
 * handleAgentMessage 培训审批 / 考核 / 答卷早退路径。
 */
import {
  evaluateTrainingExamAnswer,
  isTrainingApprovalText,
  isTrainingExamAnswerText,
  isTrainingExamStartText,
} from './helpers.js';

/**
 * @param {import('pg').Pool} pool
 * @param {{ text: string, senderRole: string, senderUsername: string, route: string }} opts
 * @returns {Promise<{ handled: true, response: string } | { handled: false }>}
 */
export async function tryHandleTrainingFlows(pool, opts) {
  const text = String(opts.text || '');
  const senderRole = opts.senderRole;
  const senderUsername = String(opts.senderUsername || '').trim();
  const route = opts.route;

  if (isTrainingApprovalText(text, senderRole)) {
    const pendingTasks = await pool.query(
      `SELECT * FROM training_tasks WHERE status = 'pending_approval' ORDER BY updated_at DESC LIMIT 1`
    );
    if (pendingTasks.rows?.length) {
      const task = pendingTasks.rows[0];
      await pool.query(
        `UPDATE training_tasks SET status = 'pending', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
      return {
        handled: true,
        response: `已将【${task.title}】的培训任务加入调度队列，Master 将尽快推送给 ${task.assignee_username} 进行学习。`,
      };
    }
  }

  if (isTrainingExamStartText(text)) {
    const tasks = await pool.query(
      `SELECT * FROM training_tasks WHERE assignee_username = $1 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`,
      [senderUsername]
    );
    if (tasks.rows?.length) {
      const task = tasks.rows[0];
      return {
        handled: true,
        response: `收到！您正在进行【${task.title}】的考核。请回答以下问题：\n\n1. 针对本课程，您认为最重要的三个实操要点是什么？\n2. 在实际工作场景中，您会如何应用所学内容？\n\n请直接回复您的答案，我将为您进行评估。`,
      };
    }
  }

  if (isTrainingExamAnswerText(text, route)) {
    const tasks = await pool.query(
      `SELECT * FROM training_tasks WHERE assignee_username = $1 AND status = 'in_progress' ORDER BY created_at DESC LIMIT 1`,
      [senderUsername]
    );
    if (tasks.rows?.length) {
      const task = tasks.rows[0];
      const passed = evaluateTrainingExamAnswer(text);
      if (passed) {
        await pool.query(
          `UPDATE training_tasks SET status = 'completed', completed_at = NOW(), progress_data = jsonb_set(progress_data, '{exam_answer}', $1::jsonb) WHERE id = $2`,
          [JSON.stringify(text), task.id]
        );
        await pool.query(
          `INSERT INTO exam_results (user_key, score, pass, created_at) VALUES ($1, $2, $3, NOW())`,
          [senderUsername, 100, true]
        );
        const evalTaskId = `EVAL-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
        await pool.query(
          `INSERT INTO master_tasks (task_id, status, source, category, severity, store, brand, title, assignee_username, score_impact, current_agent)
           VALUES ($1, 'settled', 'train_agent', '培训加分', 'low', $2, $3, $4, $5, 5, 'chief_evaluator')`,
          [evalTaskId, task.store, task.brand, `完成培训考核：${task.title}`, senderUsername]
        );
        return {
          handled: true,
          response: `✅ 恭喜您，【${task.title}】考核通过！\n\n您的评估结果已记入 HRMS 个人培训档案，并将同步反馈至您的当周绩效中（+5分）。继续保持！`,
        };
      }
      return {
        handled: true,
        response: `❌ 【${task.title}】考核未通过。\n\n您的回答过于简短，请结合实际工作场景，重新详细回答以上两个问题。`,
      };
    }
  }

  return { handled: false };
}
