/**
 * 增长方案轮次 IO：责任人候选、历史存档、真实数据拉取、方案生成、轮次查询。
 * 具名函数接收 getPool；薄 factory 在 service.js。
 */
import { SHARED_TABLES } from '@gaas/shared';
import { brandKeyOf } from './metrics-helpers.js';
import { ROLE_POSITIONS } from './constants.js';

export async function suggestAssignees(getPool, store, role) {
  const brand = brandKeyOf(store);
  const positions = ROLE_POSITIONS[role] || ROLE_POSITIONS.store_manager;
  const clauses = positions.map((_, i) => `position ILIKE '%' || $${i + 2} || '%'`).join(' OR ');
  const r = await getPool().query(
    `SELECT username, name, position FROM ${SHARED_TABLES.EMPLOYEES}
     WHERE store ILIKE '%' || $1 || '%'
       AND coalesce(status,'') NOT IN ('inactive','disabled','resigned','离职','禁用','停用')
       AND (${clauses})
     ORDER BY position, name LIMIT 20`,
    [brand, ...positions]
  );
  const prio = (p) => {
    const idx = positions.findIndex((kw) => String(p || '').includes(kw));
    return idx === -1 ? 999 : idx;
  };
  return r.rows.sort((a, b) => prio(a.position) - prio(b.position));
}

export async function saveQueryHistory(getPool, log, tenantId, store, question, resultPayload, username) {
  try {
    await getPool().query(
      `INSERT INTO growth_custom_query_history (tenant_id, store, question, result_json, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [
        tenantId || 'default',
        store,
        question,
        JSON.stringify({ title: resultPayload?.title || question, mode: resultPayload?.mode }),
        username || null,
      ]
    );
  } catch (e) {
    log.error({ msg: 'save_query_history_failed', err: e?.message || String(e) });
  }
}

export async function fetchRecentComplaints(getPool, store, days = 30) {
  const brand = brandKeyOf(store);
  const r = await getPool().query(
    `SELECT created_at::date AS date, agent_data->>'reason' AS reason,
            agent_data->>'product' AS product, agent_data->>'rating' AS rating,
            agent_data->>'platform' AS platform
       FROM ${SHARED_TABLES.AGENT_MESSAGES}
      WHERE content_type = 'negative_review'
        AND agent_data->>'store' ILIKE '%' || $1 || '%'
        AND created_at > now() - ($2 || ' days')::interval
        AND coalesce(agent_data->>'reason','') NOT ILIKE '%不存在符合要求%'
        AND coalesce(agent_data->>'reason','') NOT ILIKE '%无差评%'
        AND coalesce(agent_data->>'reason','') NOT IN ('无', '', '该评价为好评，不属于差评，无法提取差评原因。')
      ORDER BY created_at DESC LIMIT 30`,
    [brand, String(days)]
  );
  return r.rows;
}

export async function fetchTurnoverSnapshot(getPool, store) {
  const brand = brandKeyOf(store);
  const r = await getPool().query(
    `SELECT count(*) FILTER (WHERE coalesce(status,'') NOT IN ('inactive','disabled','resigned','离职','禁用','停用')) AS active,
            count(*) FILTER (WHERE coalesce(status,'') IN ('inactive','resigned','离职')) AS left_count,
            count(*) AS total
       FROM ${SHARED_TABLES.EMPLOYEES} WHERE store ILIKE '%' || $1 || '%'`,
    [brand]
  );
  const row = r.rows[0] || {};
  return {
    active: Number(row.active || 0),
    left: Number(row.left_count || 0),
    total: Number(row.total || 0),
  };
}

export async function buildPlan(getPool, store, problemKey, currentDetail) {
  const templates = await getPool().query(
    `SELECT code, title, description, assignee_role, phase, sort, why, acceptance_criteria
     FROM growth_task_templates WHERE problem_key = $1 AND enabled = TRUE ORDER BY sort`,
    [problemKey]
  );
  const plan = [];
  for (const t of templates.rows) {
    let description = t.description || '';
    if (t.code === 'assign_cert_training' || t.code === 'batch_assign') {
      const gapCount = currentDetail?.gap_count;
      if (gapCount > 0) description += `(当前共 ${gapCount} 项认证缺口)`;
    }
    if (t.code === 'launch_recall_campaign' && currentDetail?.sleeping_customers > 0) {
      description += `(可召回沉睡池 ${currentDetail.sleeping_customers} 位:高风险 ${currentDetail.sleeping_high || 0} + 中风险 ${currentDetail.sleeping_medium || 0})`;
    }
    if (t.code === 'complete_cost_library' && currentDetail?.unmatched_dishes > 0) {
      description += `(当前 ${currentDetail.unmatched_dishes} 道在售菜品缺成本)`;
    }
    if (t.code === 'review_complaint_dishes' && Array.isArray(currentDetail?.complaint_dishes) && currentDetail.complaint_dishes.length) {
      const top = currentDetail.complaint_dishes.slice(0, 5).map((c) => `${c.dish}(${c.count}次)`).join('、');
      description += `(高投诉:${top})`;
    }
    const suggested = await suggestAssignees(getPool, store, t.assignee_role);
    plan.push({
      template_code: t.code,
      title: t.title,
      description,
      phase: t.phase,
      why: t.why || '',
      acceptance_criteria: t.acceptance_criteria || '',
      assignee_role: t.assignee_role,
      suggested_assignees: suggested,
      default_assignee: suggested[0] || null,
    });
  }
  return plan;
}

export async function getOpenRound(getPool, store, problemKey) {
  const r = await getPool().query(
    `SELECT * FROM growth_solution_rounds WHERE store = $1 AND problem_key = $2 AND status <> 'closed' LIMIT 1`,
    [store, problemKey]
  );
  if (!r.rows.length) return null;
  const round = r.rows[0];
  const tasks = await getPool().query(
    `SELECT * FROM growth_solution_tasks WHERE round_id = $1 ORDER BY sort, id`,
    [round.id]
  );
  round.tasks = tasks.rows;
  return round;
}

export async function getClosedRounds(getPool, store, problemKey) {
  const r = await getPool().query(
    `SELECT * FROM growth_solution_rounds
     WHERE store = $1 AND problem_key = $2 AND status = 'closed'
     ORDER BY round_no`,
    [store, problemKey]
  );
  return r.rows;
}
