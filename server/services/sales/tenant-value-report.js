/**
 * 月度客户价值报告：证明"为什么应该续费"，区别于 bi-weekly-report.js 的餐饮经营报表——
 * 那份是给门店老板看营业额/毛利的，这份是给GAAS销售/客户成功看"系统这个月为客户做了什么"。
 */
function monthRange(month) {
  const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : new Date().toISOString().slice(0, 7);
  const start = new Date(`${m}-01T00:00:00+08:00`);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return { month: m, start, end };
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export async function buildTenantMonthlyValueReport(pool, tenantId, { month } = {}) {
  const tenant = String(tenantId || '').trim();
  if (!tenant) return { ok: false, error: 'tenant_id_required' };
  const { month: m, start, end } = monthRange(month);

  const [issuesFound, actionsExecuted, attribution, incidentsResolved, openTopIssues] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM growth_ontology_issues WHERE tenant_id=$1 AND first_detected_at >= $2 AND first_detected_at < $3`,
      [tenant, start, end]
    ).catch(() => ({ rows: [{ cnt: 0 }] })),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM master_tasks WHERE tenant_id=$1 AND status='resolved' AND resolved_at >= $2 AND resolved_at < $3`,
      [tenant, start, end]
    ).catch(() => ({ rows: [{ cnt: 0 }] })),
    pool.query(
      `SELECT COALESCE(SUM(uplift_value),0)::numeric AS uplift, COALESCE(SUM(net_value),0)::numeric AS net, COUNT(*)::int AS cnt
         FROM growth_ontology_attributions WHERE tenant_id=$1 AND created_at >= $2 AND created_at < $3`,
      [tenant, start, end]
    ).catch(() => ({ rows: [{ uplift: 0, net: 0, cnt: 0 }] })),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM tenant_health_incidents WHERE tenant_id=$1 AND resolved_at >= $2 AND resolved_at < $3`,
      [tenant, start, end]
    ).catch(() => ({ rows: [{ cnt: 0 }] })),
    pool.query(
      `SELECT issue_title, impact_amount_estimate FROM growth_ontology_issues
        WHERE tenant_id=$1 AND status='open' ORDER BY impact_amount_estimate DESC NULLS LAST LIMIT 3`,
      [tenant]
    ).catch(() => ({ rows: [] })),
  ]);

  const issuesCnt = n(issuesFound.rows?.[0]?.cnt);
  const actionsCnt = n(actionsExecuted.rows?.[0]?.cnt);
  const upliftValue = n(attribution.rows?.[0]?.uplift);
  const netValue = n(attribution.rows?.[0]?.net);
  const incidentsResolvedCnt = n(incidentsResolved.rows?.[0]?.cnt);
  const nextFocus = (openTopIssues.rows || []).map((r) => r.issue_title).filter(Boolean);

  const summaryLines = [
    `本月发现经营问题 ${issuesCnt} 个`,
    `系统自动/协助执行动作 ${actionsCnt} 项`,
    `解决健康度异常 ${incidentsResolvedCnt} 项`,
    upliftValue > 0 ? `归因带来营业额提升约 ${upliftValue.toFixed(0)} 元（净值约 ${netValue.toFixed(0)} 元）` : '本月暂无可归因的营业额提升数据',
  ];
  const text = [
    `【${tenant} · ${m} 月度价值报告】`,
    summaryLines.join('，') + '。',
    nextFocus.length ? `下月重点关注：${nextFocus.join('、')}` : '下月重点：暂无高影响待处理问题，保持现有节奏。',
  ].join('\n');

  return {
    ok: true,
    tenant_id: tenant,
    month: m,
    issues_found: issuesCnt,
    actions_executed: actionsCnt,
    incidents_resolved: incidentsResolvedCnt,
    attributed_uplift_value: upliftValue,
    attributed_net_value: netValue,
    next_month_focus: nextFocus,
    text,
  };
}
