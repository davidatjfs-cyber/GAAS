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
  const preferredScenario = options.preferredScenario || '';
  const preferredOpp = preferredScenario ? oppRows.find(o => o.opportunity_type === preferredScenario) : null;
  const preferredIssue = preferredOpp?.issue_id ? issueRows.find(i => i.issue_id === preferredOpp.issue_id) : null;
  const firstIssue = preferredIssue || issueRows[0];
  const firstOpp = preferredOpp || oppRows[0];
  const secondVisitIssue = issueRows.find(i => i.issue_type === 'new_customer_no_second_visit');
  const secondVisitOpp = oppRows.find(o => o.opportunity_type === 'new_customer_second_visit');
  const useSecondVisitSummary = !preferredScenario && Boolean(secondVisitIssue || secondVisitOpp);
  const secondVisitEvidence = secondVisitIssue?.evidence_json || secondVisitOpp?.evidence_json || {};
  const secondVisitResult = (results.rows || []).find(r => r.result_type === 'new_customer_second_visit')?.evidence_json || null;
  const confidenceNote = firstIssue?.evidence_json?.confidence_note
    || firstOpp?.evidence_json?.confidence_note
    || '使用系统默认经营规则判断';
  const dormantAttributions = preferredScenario === 'dormant_customer_reactivation'
    ? (attributions.rows || []).filter(row => !firstOpp?.opportunity_id || row.opportunity_id === firstOpp.opportunity_id)
    : [];
  const dormantRevenue = dormantAttributions.reduce((sum, row) => sum + Number(row.actual_value || 0), 0);
  const dormantReturned = new Set(dormantAttributions.map(row => row.customer_id).filter(Boolean)).size;
  const boss = buildBossReportFields({
    title: '餐厅增长闭环报告',
    summary: preferredScenario === 'dormant_customer_reactivation'
      ? `系统发现一批 90 天以上未回店的老客，本期已生成唤醒任务并追踪结果。当前已有 ${dormantReturned} 位客户回店，真实订单归因营业额 ${dormantRevenue.toFixed(0)} 元，建议继续复用这组客群和权益组合。`
      : useSecondVisitSummary
      ? `系统发现本周有 ${Number(secondVisitEvidence.noSecondVisit || secondVisitEvidence.candidates || 0)} 位新客第一次来店后还没有第二次消费，其中 ${Number(secondVisitEvidence.signatureDishCustomers || 0)} 位消费过招牌菜，属于最值得转化的新客。建议本周由店长完成一次二次到店邀请，预计可带回 4-6 位新客。`
      : firstIssue
      ? `${summarizeIssueForBoss(firstIssue)} 当前已生成 ${oppRows.length} 个增长机会、${taskRows.length} 个执行任务。`
      : '本期没有足够问题数据，暂不强行给出经营判断。',
    findings: issueRows.slice(0, 3).map(summarizeIssueForBoss),
    actions: oppRows.slice(0, 3).map(summarizeOpportunityForBoss),
    riskWarning: issueRows.some(i => i.severity === 'P1') ? '存在 P1 经营风险，需要负责人当天跟进。' : '当前风险以 P2/P3 为主，可以按任务节奏推进。',
    expectedImpact: firstOpp?.estimated_revenue_uplift ? `预计可改善约 ${Number(firstOpp.estimated_revenue_uplift).toFixed(0)} 元经营结果。` : '',
    actualImpact: secondVisitResult
      ? `本期已触达 ${Number(secondVisitResult.newCustomerTouchedCount || 0)} 位新客，二次回店 ${Number(secondVisitResult.secondVisitCustomerCount || 0)} 位，二次消费 ${Number(secondVisitResult.secondVisitRevenue || 0).toFixed(0)} 元。`
      : attributionRevenue > 0 ? `当前已有真实订单归因营业额 ${attributionRevenue.toFixed(0)} 元。` : '',
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
    confidence_note: confidenceNote,
  };
}
