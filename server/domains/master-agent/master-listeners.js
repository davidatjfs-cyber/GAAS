/**
 * Remaining master-agent tick listeners (dispatch, lifecycle, issues, train dispatch).
 */
import { AGENT_ISSUE_TYPES } from '../../agent-communication-system.js';

function getResponsibleAgent(issueType) {
  const issueConfig = AGENT_ISSUE_TYPES[issueType];
  return issueConfig?.responsibleAgent || 'master';
}

export async function dataAuditorListener(deps, tenantId = 'default') {
  const { runDataAuditor, syncDataAuditorIssuesToMasterTasks, log } = deps;
  try {
    const result = await runDataAuditor('daily', tenantId);
    return await syncDataAuditorIssuesToMasterTasks(result.newIssueIds || [], tenantId);
  } catch (e) {
    log.error('[master:data_auditor] listener error:', e?.message);
    return 0;
  }
}

export async function masterIssuesListener(deps, tenantId = 'default') {
  const { pool, log, AgentCommunicationSystem } = deps;
  try {
    const r = await pool().query(
      `SELECT * FROM agent_issues_reports WHERE status = 'pending' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 10`,
      [tenantId]
    );

    for (const issue of r.rows) {
      const responsibleAgent = getResponsibleAgent(issue.issue_type);
      await AgentCommunicationSystem.assignIssue(issue.issue_id, responsibleAgent, 'normal', null);
    }

    log.info(`[master:issues] Processed ${r.rows.length} agent issues`);
    return r.rows.length;
  } catch (e) {
    log.error('[master:issues] listener error:', e?.message);
    return 0;
  }
}

export async function masterOptimizationCoordinator(deps, tenantId = 'default') {
  const { pool, log, AgentCommunicationSystem } = deps;
  try {
    const r = await pool().query(
      `SELECT * FROM agent_issues_reports WHERE status = 'optimization_proposed' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 5`,
      [tenantId]
    );

    for (const issue of r.rows) {
      if (issue.priority === 'low' && !issue.requires_manual_review) {
        await AgentCommunicationSystem.approveOptimization(
          issue.issue_id,
          'master',
          '自动批准低优先级方案'
        );
      }
    }

    log.info(`[master:optimization] Processed ${r.rows.length} optimization proposals`);
    return r.rows.length;
  } catch (e) {
    log.error('[master:optimization] coordinator error:', e?.message);
    return 0;
  }
}

export async function masterDispatcher(deps, tenantId = 'default') {
  const { pool, log, transitionTask, resolveAssignee } = deps;
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks
       WHERE status = 'pending_dispatch'
         AND COALESCE(source, '') <> 'hrms_task_board'
         AND tenant_id = $1
       ORDER BY created_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let dispatched = 0;
    for (const task of r.rows) {
      const assignee = await resolveAssignee(
        task.category,
        task.store,
        task.assignee_username,
        task.source_data
      );
      if (!assignee) {
        log.warn(`[master] No assignee found for ${task.task_id} (${task.category}, ${task.store})`);
        continue;
      }

      const updated = await transitionTask(task.task_id, 'dispatched', 'master', {
        assignee_username: assignee.username,
        assignee_role: assignee.role,
        dispatch_data: { assignee, dispatchedBy: 'master', reason: task.category },
      }, tenantId);
      if (updated) dispatched++;
    }
    return dispatched;
  } catch (e) {
    log.error('[master] dispatcher error:', e?.message);
    return 0;
  }
}

export async function masterPostResolution(deps, tenantId = 'default') {
  const { pool, log, transitionTask } = deps;
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks WHERE status = 'resolved' AND tenant_id = $1 ORDER BY resolved_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let count = 0;
    for (const task of r.rows) {
      const updated = await transitionTask(task.task_id, 'pending_settlement', 'master', {}, tenantId);
      if (updated) count++;
    }
    return count;
  } catch (e) {
    log.error('[master] post-resolution error:', e?.message);
    return 0;
  }
}

export async function masterHandleRejected(deps, tenantId = 'default') {
  const { pool, log, transitionTask } = deps;
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks
       WHERE status = 'rejected'
         AND COALESCE(source, '') <> 'hrms_task_board'
         AND tenant_id = $1
       ORDER BY resolved_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let count = 0;
    for (const task of r.rows) {
      const updated = await transitionTask(task.task_id, 'pending_dispatch', 'master', {}, tenantId);
      if (updated) count++;
    }
    return count;
  } catch (e) {
    log.error('[master] handle-rejected error:', e?.message);
    return 0;
  }
}

export async function chiefEvaluatorListener(deps, tenantId = 'default') {
  const { pool, log, transitionTask } = deps;
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks WHERE status = 'pending_settlement' AND tenant_id = $1 ORDER BY resolved_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let count = 0;
    for (const task of r.rows) {
      const responseHours =
        task.dispatched_at && task.responded_at
          ? (new Date(task.responded_at) - new Date(task.dispatched_at)) / 3600000
          : null;

      const updated = await transitionTask(task.task_id, 'settled', 'chief_evaluator', {
        settlement_data: {
          scoreImpact: 0,
          reason: '旧OP周绩效扣分体系已停用；该任务仅完成闭环归档，不做积分扣减。',
          category: task.category,
          severity: task.severity,
          responseTime: responseHours == null ? 'N/A' : `${responseHours.toFixed(1)}h`,
          settledAt: new Date().toISOString(),
        },
        score_impact: 0,
      }, tenantId);

      if (updated) count++;
    }
    return count;
  } catch (e) {
    log.error('[master:evaluator] settlement error:', e?.message);
    return 0;
  }
}

export async function masterFinalNotification(deps, tenantId = 'default') {
  const { pool, log, transitionTask, lookupFeishuUserByUsername, sendLarkMessage, prefixWithAgentName } =
    deps;
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks WHERE status = 'settled' AND tenant_id = $1 ORDER BY settled_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let count = 0;
    for (const task of r.rows) {
      if (task.assignee_username) {
        const fu = await lookupFeishuUserByUsername(task.assignee_username);
        if (fu?.open_id) {
          const msgText =
            `📋 任务完成通知 [${task.task_id}]\n\n✅ ${task.title}\n\n该任务已完成闭环并归档。\n（旧OP周绩效积分已停用，本任务不做周积分扣减）\n\n感谢配合处理！`;
          await sendLarkMessage(fu.open_id, prefixWithAgentName('master', msgText));
        }
      }

      await transitionTask(task.task_id, 'closed', 'master', {}, tenantId);
      count++;
    }
    return count;
  } catch (e) {
    log.error('[master] final notification error:', e?.message);
    return 0;
  }
}

export async function trainTaskDispatcher(deps, tenantId = 'default') {
  const { pool, log, lookupFeishuUserByUsername, sendLarkMessage, prefixWithAgentName } = deps;
  let dispatched = 0;
  try {
    const pendingTasks = await pool().query(
      `SELECT * FROM training_tasks WHERE status = 'pending' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 10`,
      [tenantId]
    );
    for (const task of pendingTasks.rows || []) {
      const fu = await lookupFeishuUserByUsername(task.assignee_username);
      if (fu?.open_id) {
        const typeLabel =
          {
            onboarding: '入职培训',
            skill_upgrade: '技能提升',
            management: '管理培训',
            culture: '企业文化',
          }[task.type] || task.type;

        const dueDateStr = task.due_date ? new Date(task.due_date).toLocaleDateString() : '无';
        const msg = prefixWithAgentName(
          'train_advisor',
          `🎯 培训任务下发 [${task.task_id}]\n\n` +
            `课程标题：${task.title}\n` +
            `培训类型：${typeLabel}\n` +
            `要求岗位：${task.target_role}\n` +
            `截止日期：${dueDateStr}\n\n` +
            `请及时学习相关资料。学习完成后，可直接回复我“开始考核”或随时向我提问关于本课程的疑惑。`
        );
        await sendLarkMessage(fu.open_id, msg);
      }
      await pool().query(
        `UPDATE training_tasks SET status = 'in_progress', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
      dispatched++;
      log.info(`[master:train] Dispatched training task ${task.task_id} to ${task.assignee_username}`);
    }
  } catch (e) {
    log.error('[master:train] task dispatcher error:', e?.message);
  }
  return dispatched;
}
