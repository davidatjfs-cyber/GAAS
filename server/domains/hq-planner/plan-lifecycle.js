/**
 * HQ Planner — Plan Lifecycle Management (计划生命周期管理)
 * 从 hq-planner-agent.js 拆出。ctx = { pool, log }（避免反向 import）。
 */
import axios from 'axios';
import { getActiveTenantIds, tenantContext } from '../../utils/database.js';
import { createAgentsServiceAuthHelpers, agentsOutboundHeaders } from '../shared/agents-service-auth.js';

const { getAgentsServiceBaseUrl, getAgentsServiceAdminToken } = createAgentsServiceAuthHelpers({ axios });

async function createBoardTaskViaV2({ content, priority, store, createdBy: _createdBy, createdByRole: _createdByRole, requestId }) {
  try {
    const token = await getAgentsServiceAdminToken();
    const r = await axios.post(getAgentsServiceBaseUrl() + '/api/agent-task-board/tasks', { content, priority, store }, {
      timeout: 10000,
      validateStatus: () => true,
      headers: agentsOutboundHeaders({ requestId }, {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }),
    });
    if (r.status < 200 || r.status >= 300) return { ok: false, error: `v2_api_${r.status}` };
    return r.data;
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

// action_plans开了FORCE RLS。审批/驳回从HTTP路由(已有ALS)和机器人消息(没有)两种
// 路径调用，plan_id所属租户调用方未必知道——逐个active租户找到这条计划所在的租户，
// 后续操作都在那个租户的上下文里做。
export async function findActionPlanTenant(ctx, planId) {
  for (const tenantId of await getActiveTenantIds(ctx.pool())) {
    const r = await tenantContext.run(tenantId, () =>
      ctx.pool().query(`SELECT * FROM action_plans WHERE plan_id = $1`, [planId])
    );
    if (r.rows?.length) return { tenantId, plan: r.rows[0] };
  }
  return { tenantId: null, plan: null };
}

// 审批通过 → 拆解为 OP 任务
export async function approvePlan(ctx, planId, approvedBy, opts = {}) {
  try {
    const { tenantId, plan } = await findActionPlanTenant(ctx, planId);
    if (!plan) return { ok: false, error: 'not_found' };
    if (plan.status !== 'pending_review') return { ok: false, error: `invalid_status: ${plan.status}` };

    return await tenantContext.run(tenantId, async () => {
    await ctx.pool().query(
      `UPDATE action_plans SET status = 'approved', approved_by = $1, updated_at = NOW() WHERE plan_id = $2`,
      [approvedBy, planId]
    );

    // 将行动计划拆解为 master_tasks
    const planData = plan.plan_data || {};
    const actions = Array.isArray(planData.actions) ? planData.actions : [];
    let createdTasks = 0;

    for (const action of actions) {
      try {
        const content = `行动计划任务：${action.action || '待执行任务'}\n来源计划: ${planId}\nKPI目标: ${action.kpiTarget || '无'}\n验收标准: ${action.verificationMethod || '无'}\n截止: ${action.deadline || '无'}`;
        const v2result = await createBoardTaskViaV2({
          content,
          priority: action.priority || 'medium',
          store: plan.store,
          createdBy: approvedBy,
          createdByRole: 'hq_manager',
          requestId: opts.requestId,
        });
        if (v2result.ok) createdTasks++;
        else ctx.log.error({ msg: 'v2_create_board_task_failed', request_id: opts.requestId || null, err: v2result.error });
      } catch (e) {
        ctx.log.error({ msg: 'create_task_from_plan_action_failed', err: e?.message });
      }
    }

    await ctx.pool().query(
      `UPDATE action_plans SET status = 'executing', updated_at = NOW() WHERE plan_id = $1`,
      [planId]
    );

    ctx.log.info({ msg: 'plan_approved', plan_id: planId, tasks_created: createdTasks });
    return { ok: true, planId, createdTasks };
    });
  } catch (e) {
    ctx.log.error({ msg: 'approve_plan_failed', err: e?.message });
    return { ok: false, error: e?.message };
  }
}

// 驳回计划
export async function rejectPlan(ctx, planId, rejectedBy, reason) {
  try {
    const { tenantId, plan } = await findActionPlanTenant(ctx, planId);
    if (!plan) return { ok: false, error: 'not_found' };
    await tenantContext.run(tenantId, () =>
      ctx.pool().query(
        `UPDATE action_plans SET status = 'rejected', updated_at = NOW(),
         compliance_result = compliance_result || $1::jsonb
         WHERE plan_id = $2`,
        [JSON.stringify({ rejectedBy, rejectionReason: reason, rejectedAt: new Date().toISOString() }), planId]
      )
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message };
  }
}

// 查询计划列表
export async function listPlans(ctx, options = {}) {
  const { store, status, limit = 20 } = options;
  const where = ['1=1'];
  const params = [];
  const push = v => { params.push(v); return `$${params.length}`; };

  if (store) where.push(`store = ${push(store)}`);
  if (status) where.push(`status = ${push(status)}`);

  const r = await ctx.pool().query(
    `SELECT * FROM action_plans WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ${push(limit)}`,
    params
  );
  return r.rows || [];
}
