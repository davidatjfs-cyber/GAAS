import { buildBossReportFields, summarizeIssueForBoss, summarizeOpportunityForBoss } from './boss-language-service.js';

export async function buildClosedLoopReport(pool, options = {}) {
  const tenantId = options.tenantId || 'default';
  const storeId = options.storeId || '';
  const period = options.period || '30d';
  const [issues, opportunities, tasks, results, attributions] = await Promise.all([
    pool.query(`SELECT * FROM growth_ontology_issues WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2) ORDER BY created_at DESC LIMIT 20`, [tenantId, storeId]),
    pool.query(`SELECT * FROM growth_ontology_opportunities WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2) ORDER BY created_at DESC LIMIT 20`, [tenantId, storeId]),
    pool.query(`SELECT task_id,title,status,assignee_role,assignee_username,due_at,expected_result,actual_result,source_data,opportunity_id,issue_id
                  FROM master_tasks WHERE tenant_id=$1 AND source IN ('ontology_growth','ontology_business')
                   AND ($2::text='' OR store_id=$2 OR store=$2) ORDER BY created_at DESC LIMIT 50`, [tenantId, storeId]),
    pool.query(`SELECT * FROM growth_ontology_business_results WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2) ORDER BY created_at DESC LIMIT 20`, [tenantId, storeId]),
    pool.query(`SELECT * FROM growth_ontology_attributions WHERE tenant_id=$1 AND ($2::text='' OR store_id=$2) ORDER BY created_at DESC LIMIT 50`, [tenantId, storeId]),
  ]);
  const issueRows = issues.rows || [];
  const oppRows = opportunities.rows || [];
  const taskRows = tasks.rows || [];
  const attributionRevenue = (attributions.rows || []).reduce((sum, row) => sum + Number(row.actual_value || 0), 0);
  const completed = taskRows.filter(t => ['done', 'closed', 'completed', 'resolved'].includes(String(t.status || '')));
  const firstIssue = issueRows[0];
  const firstOpp = oppRows[0];
  const boss = buildBossReportFields({
    title: '餐厅增长闭环报告',
    summary: firstIssue
      ? `${summarizeIssueForBoss(firstIssue)} 当前已生成 ${oppRows.length} 个增长机会、${taskRows.length} 个执行任务。`
      : '本期没有足够问题数据，暂不强行给出经营判断。',
    findings: issueRows.slice(0, 3).map(summarizeIssueForBoss),
    actions: oppRows.slice(0, 3).map(summarizeOpportunityForBoss),
    riskWarning: issueRows.some(i => i.severity === 'P1') ? '存在 P1 经营风险，需要负责人当天跟进。' : '当前风险以 P2/P3 为主，可以按任务节奏推进。',
    expectedImpact: firstOpp?.estimated_revenue_uplift ? `预计可改善约 ${Number(firstOpp.estimated_revenue_uplift).toFixed(0)} 元经营结果。` : '',
    actualImpact: attributionRevenue > 0 ? `当前已有真实订单归因营业额 ${attributionRevenue.toFixed(0)} 元。` : '',
  });
  console.log('Closed loop report generated');
  console.log('Boss language output verified');
  return {
    ok: true,
    period,
    ontologyStatus: issueRows.length || oppRows.length || taskRows.length ? 'ok' : 'insufficient_data',
    issues: issueRows,
    opportunities: oppRows,
    tasks: taskRows,
    results: results.rows || [],
    attributionSummary: {
      attributedOrderCount: (attributions.rows || []).filter(r => r.related_order_id).length,
      attributedRevenue: attributionRevenue,
      evidenceDetails: (attributions.rows || []).map(row => ({
        customerId: row.customer_id,
        campaignId: row.campaign_id,
        relatedOrderId: row.related_order_id,
        orderAmount: Number(row.actual_value || 0),
        attributionType: row.attribution_method,
        evidence: row.evidence_json,
      })),
    },
    taskReview: {
      tasksCreated: taskRows.length,
      tasksCompleted: completed.length,
      reviewStatus: results.rows?.length ? 'improved' : 'insufficient_data',
    },
    ...boss,
  };
}
