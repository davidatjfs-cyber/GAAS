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

export async function buildSalesBossDashboard(pool) {
  const { listLeads } = await import('./sales-store.js');
  const leads = await listLeads(pool, { limit: 500 });
  const metrics = buildSalesBossMetrics(leads);
  const loss_stats = await listLossReasonStats(pool, 10);
  return { ok: true, metrics, loss_stats };
}
