import { randomUUID } from 'node:crypto';
import { summarizeOpportunityForBoss } from './boss-language-service.js';

function dueDate(days = 7) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function buildTaskDraftsForOpportunity(opportunity = {}) {
  const actions = Array.isArray(opportunity.recommended_actions_json) ? opportunity.recommended_actions_json : [];
  const base = actions.length ? actions : [{ actionName: summarizeOpportunityForBoss(opportunity), step: 1 }];
  return base.map((action, idx) => ({
    title: action.actionName || opportunity.title || '经营增长动作',
    description: `${opportunity.title || '经营增长机会'}：${action.actionName || '执行跟进动作'}`,
    ownerRole: opportunity.opportunity_type === 'staff_execution_improvement' || opportunity.opportunity_type === 'new_customer_second_visit' ? '店长' : '营销负责人',
    priority: opportunity.priority || 'P2',
    dueDate: dueDate(idx === 0 ? 3 : 7),
    expectedResult: opportunity.opportunity_type === 'new_customer_second_visit'
      ? '新客二次到店率 >= 12%'
      : opportunity.estimated_revenue_uplift
      ? `预计带来 ${Number(opportunity.estimated_revenue_uplift).toFixed(0)} 元经营改善`
      : '形成可追踪的回店、复购或执行改善结果',
    trackingMetrics: opportunity.opportunity_type === 'new_customer_second_visit'
      ? ['新客触达人数', '二次回店人数', '二次回店率', '二次消费金额', '优惠成本', '净增量']
      : ['回店人数', '贡献营业额', '任务完成率'],
    sourceIssueId: opportunity.issue_id || '',
    sourceDomain: 'restaurant_growth',
    sourceReportType: 'growth_closed_loop',
    ontologyInsightId: opportunity.opportunity_id || '',
    opportunityId: opportunity.opportunity_id || '',
    actionType: opportunity.opportunity_type === 'new_customer_second_visit' ? 'invite_second_visit' : (opportunity.opportunity_type || ''),
    status: 'draft',
  }));
}

export async function generateTasksForOpportunity(pool, opportunityId, options = {}) {
  const tenantId = options.tenantId || 'default';
  const ownerUserId = options.ownerUserId || '';
  const storeId = options.storeId || '';
  const r = await pool.query(
    `SELECT * FROM growth_ontology_opportunities WHERE tenant_id=$1 AND opportunity_id=$2 LIMIT 1`,
    [tenantId, opportunityId]
  );
  const opportunity = r.rows?.[0];
  if (!opportunity) return { ok: false, error: 'opportunity_not_found', tasks: [] };
  const drafts = buildTaskDraftsForOpportunity(opportunity);
  const created = [];
  for (const draft of drafts) {
    const taskId = `GROWTH-${randomUUID()}`;
    const sourceData = {
      ontology: true,
      sourceIssueId: draft.sourceIssueId,
      sourceDomain: draft.sourceDomain,
      sourceReportType: draft.sourceReportType,
      ontologyInsightId: draft.ontologyInsightId,
      opportunityId,
      expectedResult: draft.expectedResult,
      trackingMetrics: draft.trackingMetrics,
      ownerRole: draft.ownerRole,
    };
    const inserted = await pool.query(
      `INSERT INTO master_tasks (
        task_id, tenant_id, store, store_id, status, source, source_ref, current_agent, category,
        severity, title, detail, source_data, assignee_role, assignee_username,
        entity_type, entity_id, issue_id, opportunity_id, owner_role, owner_id,
        action_type, action_detail, priority, due_at, expected_result
      ) VALUES ($1,$2,$3,$4,'pending_dispatch','ontology_growth',$5,'master',$6,$7,$8,$9,$10::jsonb,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING *`,
      [
        taskId, tenantId, storeId || opportunity.store_id, storeId || opportunity.store_id,
        opportunityId, opportunity.opportunity_type, draft.priority === 'P1' ? 'high' : 'medium',
        draft.title, draft.description, JSON.stringify(sourceData), draft.ownerRole, ownerUserId,
        opportunity.target_entity_type, '', opportunity.issue_id, opportunityId, draft.ownerRole, ownerUserId,
        draft.actionType || opportunity.opportunity_type, draft.description, draft.priority, draft.dueDate, draft.expectedResult,
      ]
    );
    created.push(inserted.rows[0]);
  }
  await pool.query(`UPDATE growth_ontology_opportunities SET status='task_generated', updated_at=now() WHERE opportunity_id=$1`, [opportunityId]);
  console.log('Tasks generated');
  if (opportunity.opportunity_type === 'new_customer_second_visit') console.log('New customer second visit task generated');
  return { ok: true, taskDrafts: drafts, tasks: created };
}
