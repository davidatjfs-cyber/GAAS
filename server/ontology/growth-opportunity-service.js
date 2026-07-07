import { randomUUID } from 'node:crypto';

const OPPORTUNITY_BY_ISSUE = {
  revenue_decline: ['lunch_revenue_recovery', 'low_repeat_dish_optimization'],
  repeat_decline: ['new_customer_second_visit', 'dormant_customer_reactivation'],
  customer_asset_risk: ['vip_retention', 'stored_value_customer_activation'],
  staff_execution_risk: ['staff_execution_improvement'],
  marketing_ineffective: ['dormant_customer_reactivation', 'vip_retention'],
};

const ACTIONS = {
  dormant_customer_reactivation: ['导出沉睡客户名单', '安排店长逐批触达', '7天追踪回店和消费'],
  vip_retention: ['筛选高价值未回店客户', '配置专属权益', '店长跟进回访'],
  new_customer_second_visit: ['筛选首次到店新客', 'D4/D8 二次触达', '追踪二次回店率'],
  stored_value_customer_activation: ['筛选储值未消费客户', '提醒余额权益', '追踪储值消费转化'],
  low_repeat_dish_optimization: ['复盘低复购菜品', '检查出品稳定性', '调整推荐话术'],
  lunch_revenue_recovery: ['拆解午市客群', '设计午市套餐', '追踪午市营业额'],
  negative_review_recovery: ['汇总差评原因', '安排责任岗位整改', '回访差评客户'],
  staff_execution_improvement: ['明确责任岗位', '设定截止时间', '每日复盘完成率'],
};

const TITLES = {
  dormant_customer_reactivation: '沉睡客户唤醒',
  vip_retention: '高价值客户维护',
  new_customer_second_visit: '新客二次回店',
  stored_value_customer_activation: '储值客户激活',
  low_repeat_dish_optimization: '低复购菜品优化',
  lunch_revenue_recovery: '午市营业恢复',
  negative_review_recovery: '差评修复',
  staff_execution_improvement: '员工执行改善',
};

export function opportunityTypesForIssue(issueType) {
  return OPPORTUNITY_BY_ISSUE[issueType] || [];
}

export function buildOpportunityFromIssue(issue, opportunityType) {
  const title = TITLES[opportunityType] || '经营增长机会';
  const evidence = issue.evidence_json || issue.evidence || {};
  const estimatedRevenue = Number(evidence.revenueGap || issue.impact_amount_estimate || 0);
  const estimatedCost = opportunityType.includes('customer') || opportunityType.includes('vip') ? 300 : 0;
  return {
    opportunity_id: `opp_${randomUUID()}`,
    tenant_id: issue.tenant_id || 'default',
    store_id: issue.store_id || '',
    issue_id: issue.issue_id,
    opportunity_type: opportunityType,
    title,
    description: `${title}：围绕“${issue.issue_title || issue.issue_type}”生成可执行动作。`,
    target_entity_type: opportunityType.includes('dish') ? 'dish' : 'customer_segment',
    target_entity_ids_json: [],
    estimated_revenue_uplift: estimatedRevenue,
    estimated_cost: estimatedCost,
    expected_roi: estimatedCost > 0 ? Number((estimatedRevenue / estimatedCost).toFixed(2)) : null,
    priority: issue.severity === 'P1' ? 'P1' : 'P2',
    evidence_json: evidence,
    recommended_actions_json: (ACTIONS[opportunityType] || ['生成整改动作', '追踪经营结果']).map((name, idx) => ({ actionName: name, step: idx + 1 })),
    status: 'open',
  };
}

export async function createOpportunitiesForIssue(pool, issue) {
  const created = [];
  for (const type of opportunityTypesForIssue(issue.issue_type)) {
    const opp = buildOpportunityFromIssue(issue, type);
    const result = await pool.query(
      `INSERT INTO growth_ontology_opportunities (
        opportunity_id, tenant_id, store_id, issue_id, opportunity_type, title, description,
        target_entity_type, target_entity_ids_json, estimated_revenue_uplift, estimated_cost,
        expected_roi, priority, evidence_json, recommended_actions_json, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16)
      ON CONFLICT (opportunity_id) DO UPDATE SET updated_at = now()
      RETURNING *`,
      [
        opp.opportunity_id, opp.tenant_id, opp.store_id, opp.issue_id, opp.opportunity_type,
        opp.title, opp.description, opp.target_entity_type, JSON.stringify(opp.target_entity_ids_json),
        opp.estimated_revenue_uplift, opp.estimated_cost, opp.expected_roi, opp.priority,
        JSON.stringify(opp.evidence_json), JSON.stringify(opp.recommended_actions_json), opp.status,
      ]
    );
    created.push(result.rows[0]);
  }
  return created;
}

export async function listOpportunities(pool, options = {}) {
  const tenantId = options.tenantId || 'default';
  const storeId = String(options.storeId || '').trim();
  const result = await pool.query(
    `SELECT * FROM growth_ontology_opportunities
      WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2)
      ORDER BY created_at DESC LIMIT 100`,
    [tenantId, storeId]
  );
  return result.rows || [];
}
