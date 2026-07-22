/**
 * 老板/销售效率看板指标
 */
import { buildFunnelStats, buildRiskCustomers, buildTopHighLeads } from './sales-ops.js';
import { listLossReasonStats } from './sales-store.js';

const STAGE_ORDER = ['new', 'ai_greeting', 'need_identified', 'sales_takeover', 'demo_completed', 'proposal', 'trial', 'won'];

export function buildSalesBossMetrics(leads = []) {
  const funnel = buildFunnelStats(leads);
  const total = leads.length || 1;
  const won = leads.filter((l) => l.stage === 'won').length;
  const lost = leads.filter((l) => l.stage === 'lost').length;
  const trial = leads.filter((l) => l.stage === 'trial' || l.trial_status === 'in_progress').length;
  const demo = leads.filter((l) => (l.demo_count || 0) > 0).length;
  const high = leads.filter((l) => l.intent_level === 'high').length;

  const conversion = {
    lead_to_demo: demo / total,
    demo_to_trial: demo ? trial / demo : 0,
    trial_to_won: trial ? won / trial : 0,
    overall_win: won / total,
  };

  const byOwner = {};
  for (const l of leads) {
    const o = l.owner_username || '未分配';
    if (!byOwner[o]) byOwner[o] = { owner: o, leads: 0, high: 0, won: 0, demos: 0, avg_score: 0, _score_sum: 0 };
    byOwner[o].leads += 1;
    byOwner[o]._score_sum += l.intent_score || 0;
    if (l.intent_level === 'high') byOwner[o].high += 1;
    if (l.stage === 'won') byOwner[o].won += 1;
    if ((l.demo_count || 0) > 0) byOwner[o].demos += 1;
  }
  const owner_stats = Object.values(byOwner).map((o) => ({
    ...o,
    avg_score: Math.round(o._score_sum / Math.max(1, o.leads)),
    win_rate: o.leads ? Math.round((o.won / o.leads) * 100) : 0,
  })).sort((a, b) => b.won - a.won || b.high - a.high);

  const stage_velocity = [];
  for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
    const from = STAGE_ORDER[i];
    const to = STAGE_ORDER[i + 1];
    const fromN = leads.filter((l) => l.stage === from || (from === 'new' && ['new', 'ai_greeting'].includes(l.stage))).length;
    const toN = leads.filter((l) => l.stage === to).length;
    stage_velocity.push({ from, to, from_count: fromN, to_count: toN, rate: fromN ? Math.round((toN / fromN) * 100) : 0 });
  }

  return {
    summary: {
      total: leads.length,
      high_intent: high,
      won,
      lost,
      trial_active: trial,
      win_rate_pct: Math.round(conversion.overall_win * 100),
      demo_rate_pct: Math.round(conversion.lead_to_demo * 100),
    },
    funnel,
    conversion: {
      lead_to_demo_pct: Math.round(conversion.lead_to_demo * 100),
      demo_to_trial_pct: Math.round(conversion.demo_to_trial * 100),
      trial_to_won_pct: Math.round(conversion.trial_to_won * 100),
      overall_win_pct: Math.round(conversion.overall_win * 100),
    },
    owner_stats,
    stage_velocity,
    top5: buildTopHighLeads(leads),
    risks: buildRiskCustomers(leads).slice(0, 8),
  };
}

export function buildSalesConversionReadiness(snapshot = {}) {
  const checks = [
    { key: 'human_handoff', label: '真人接管', ready: Number(snapshot.active_reps || 0) > 0, weight: 30, impact: '高意向客户能否立即由真人继续成交' },
    { key: 'commercial_knowledge', label: '销售知识', ready: Number(snapshot.active_knowledge || 0) >= 10, weight: 20, impact: '卖点、方案和合作边界能否稳定回答' },
    { key: 'approved_material', label: '对外资料', ready: Number(snapshot.approved_assets || 0) > 0, weight: 15, impact: '客户索要资料时能否立即发送' },
    { key: 'approved_case', label: '授权案例', ready: Number(snapshot.approved_cases || 0) > 0, weight: 15, impact: '客户需要真实证据时能否建立信任' },
    { key: 'nurture_content', label: '培育内容', ready: Number(snapshot.auto_assets || 0) > 0, weight: 10, impact: '未立即成交客户能否持续、合规触达' },
    { key: 'conversion_tracking', label: '转化追踪', ready: snapshot.tracking_ready !== false, weight: 10, impact: '能否判断改造是否真正带来演示、试跑和成交' },
  ];
  const score = checks.reduce((sum, item) => sum + (item.ready ? item.weight : 0), 0);
  return {
    score,
    status: score >= 90 ? 'ready' : score >= 70 ? 'partially_ready' : 'blocked',
    checks,
    blockers: checks.filter((item) => !item.ready).map((item) => ({ key: item.key, label: item.label, impact: item.impact })),
  };
}

export async function buildSalesBossDashboard(pool) {
  const { listLeads } = await import('./sales-store.js');
  const leads = await listLeads(pool, { limit: 500 });
  const metrics = buildSalesBossMetrics(leads);
  const [loss_stats, readinessRow, actionRows, outcomeRow] = await Promise.all([
    listLossReasonStats(pool, 10),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM sales_reps WHERE status='active' AND role IN ('sales','sales_manager')) AS active_reps,
      (SELECT COUNT(*)::int FROM sales_knowledge_items WHERE active=true) AS active_knowledge,
      (SELECT COUNT(*)::int FROM sales_content_assets WHERE active=true AND external_approved=true AND knowledge_domain='customer_ai' AND (effective_from IS NULL OR effective_from<=NOW()) AND (expires_at IS NULL OR expires_at>NOW())) AS approved_assets,
      (SELECT COUNT(*)::int FROM sales_content_assets WHERE active=true AND external_approved=true AND auto_send_allowed=true AND knowledge_domain='customer_ai' AND (effective_from IS NULL OR effective_from<=NOW()) AND (expires_at IS NULL OR expires_at>NOW())) AS auto_assets,
      (SELECT COUNT(*)::int FROM sales_case_assets WHERE status='active' AND external_use_allowed=true AND anonymized=true) AS approved_cases,
      (to_regclass('public.sales_action_logs') IS NOT NULL) AS tracking_ready`),
    pool.query(`SELECT action_type,COUNT(*)::int AS count
      FROM sales_action_logs
      WHERE created_at >= NOW() - INTERVAL '30 days' AND action_type LIKE 'customer_ai_%'
      GROUP BY action_type ORDER BY count DESC,action_type`),
    pool.query(`WITH requests AS (
        SELECT lead_id,action_type,MIN(created_at) AS requested_at
        FROM sales_action_logs
        WHERE created_at >= NOW() - INTERVAL '30 days'
          AND action_type IN ('customer_ai_demo_requested','customer_ai_trial_requested','customer_ai_contact_requested','customer_ai_price_requested','customer_ai_discount_requested')
        GROUP BY lead_id,action_type
      )
      SELECT
        COUNT(DISTINCT lead_id) FILTER (WHERE action_type='customer_ai_demo_requested')::int AS demo_requested,
        COUNT(DISTINCT lead_id) FILTER (WHERE action_type='customer_ai_demo_requested' AND EXISTS (SELECT 1 FROM sales_demos d WHERE d.lead_id=requests.lead_id AND d.created_at>=requests.requested_at))::int AS demo_created,
        COUNT(DISTINCT lead_id) FILTER (WHERE action_type='customer_ai_trial_requested')::int AS trial_requested,
        COUNT(DISTINCT lead_id) FILTER (WHERE action_type='customer_ai_trial_requested' AND EXISTS (SELECT 1 FROM sales_trials t WHERE t.lead_id=requests.lead_id AND t.created_at>=requests.requested_at))::int AS trial_started,
        COUNT(DISTINCT lead_id) FILTER (WHERE action_type IN ('customer_ai_contact_requested','customer_ai_price_requested','customer_ai_discount_requested'))::int AS handoff_requested,
        COUNT(DISTINCT lead_id) FILTER (WHERE action_type IN ('customer_ai_contact_requested','customer_ai_price_requested','customer_ai_discount_requested') AND EXISTS (SELECT 1 FROM sales_lead_events e WHERE e.lead_id=requests.lead_id AND e.event_type='HUMAN_TAKEOVER' AND e.created_at>=requests.requested_at))::int AS human_takeover
      FROM requests`),
  ]);
  return {
    ok: true,
    metrics,
    loss_stats,
    conversion_readiness: buildSalesConversionReadiness(readinessRow.rows?.[0] || { tracking_ready: false }),
    customer_ai_actions_30d: actionRows.rows || [],
    customer_ai_outcomes_30d: outcomeRow.rows?.[0] || {},
  };
}
