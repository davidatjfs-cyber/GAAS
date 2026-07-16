/**
 * 销售 AI 后台：更新档案、任务、建议、日报、风险预警、漏斗
 */
import { scoreLead, persistScore, computeWinProbability } from './sales-scoring.js';
import { addEvent, ensureSalesTables, listLeads, upsertTask, completeTask, loadLeadFunnel } from './sales-store.js';
import { deriveTagsForLead, recommendCaseTheme, recommendAssets, recommendNextSteps } from './sales-tags.js';
import { buildDiagnosisReport, summarizeMeeting, detectOvercommitment, matchObjection, getObjectionResponse, buildDemoBrief } from './sales-diagnosis.js';

export function buildNextAction(lead, score) {
  if (score.intent_level === 'high' || (lead.controller === 'ai' && score.intent_score >= 70)) {
    return { next_action: '10分钟内人工接管并预约Demo', priority: 'high', due_hours: 0.2 };
  }
  if (!lead.store_count) return { next_action: '确认门店数量', priority: 'normal', due_hours: 24 };
  if (!lead.pain_points?.length && !lead.extracted?.pain_point) return { next_action: '确认核心经营痛点', priority: 'normal', due_hours: 24 };
  if (lead.phone_data_ready == null) return { next_action: '确认POS是否有手机号', priority: 'normal', due_hours: 24 };
  if (lead.demo_count === 0 && score.intent_level === 'medium') return { next_action: '发送匹配案例并约演示', priority: 'medium', due_hours: 48 };
  if (lead.demo_count > 0 && !lead.trial_status) return { next_action: '确认决策人并推进试跑', priority: 'medium', due_hours: 48 };
  if (lead.trial_status === 'in_progress') return { next_action: '检查试跑数据与目标达成', priority: 'medium', due_hours: 72 };
  return { next_action: '保持轻触达，补齐关键信息', priority: 'low', due_hours: 120 };
}

export function buildSalesAdvice(lead, score) {
  const pain = lead.extracted?.pain_point || (lead.pain_points || [])[0] || '未明确';
  const lines = [
    `意向 ${score.intent_score}（${score.intent_level}）`,
    `成交概率 ${lead.win_probability ?? computeWinProbability(lead)}%`,
    `痛点优先讲：${pain}`,
    '禁止承诺：全POS可接 / 定制 / 私自折扣 / 保证效果',
  ];
  if (score.intent_level === 'high') lines.push('建议立即接管，先确认决策人与Demo时间');
  if (lead.phone_data_ready === false) lines.push('风险：数据基础弱，先谈可行性再报价');
  if (lead.decision_role !== '老板' && lead.decision_role) lines.push('风险：未确认最终决策人');
  const theme = recommendCaseTheme(lead);
  lines.push(`推荐案例主题：${theme}`);
  return lines.join('\n');
}

export async function applyLeadUpdates(pool, leadId, { extracted, events, score, controller, stage, handoff_level, last_sales_decision }) {
  await ensureSalesTables(pool);
  const pain = extracted?.pain_point ? [extracted.pain_point] : [];
  const tags = deriveTagsForLead({
    store_count: extracted?.store_count,
    phone_data_ready: extracted?.phone_data_ready,
    pain_point: extracted?.pain_point,
    stage: stage || null,
    intent_level: score.intent_level,
    member_estimate: extracted?.member_estimate,
    cuisine: extracted?.cuisine,
    budget_range: extracted?.budget_range,
    extracted,
    events,
  });
  const next = buildNextAction({ ...extracted, pain_points: pain, stage: stage || null }, score);
  const winProb = computeWinProbability({ stage: stage || 'new', intent_score: score.intent_score });
  await pool.query(
    `UPDATE sales_leads SET
        name = COALESCE($2, name),
        company = COALESCE($3, company),
        phone = COALESCE($4, phone),
        store_count = COALESCE($5, store_count),
        pos_brand = COALESCE($6, pos_brand),
        phone_data_ready = CASE
          WHEN COALESCE($14::jsonb->'uncertain_slots', '[]'::jsonb) ? 'phone_data_ready' THEN NULL
          ELSE COALESCE($7, phone_data_ready)
        END,
        city = COALESCE($8, city),
        cuisine = COALESCE($9, cuisine),
        decision_role = COALESCE($10, decision_role),
        member_estimate = COALESCE($11, member_estimate),
        budget_range = COALESCE($12, budget_range),
        pain_points = CASE WHEN $13::jsonb = '[]'::jsonb THEN pain_points ELSE $13::jsonb END,
        extracted = COALESCE(extracted,'{}'::jsonb) || $14::jsonb,
        controller = COALESCE($15, controller),
        stage = COALESCE($16, stage),
        intent_score = $17,
        intent_level = $18,
        tags = $19::jsonb,
        win_probability = $20,
        next_action = $21,
        next_action_due = NOW() + ($22)::INTERVAL,
        handoff_level = COALESCE($23, handoff_level),
        last_sales_decision = COALESCE($24::jsonb, last_sales_decision),
        last_message_at = NOW(),
        updated_at = NOW()
      WHERE id=$1`,
    [
      leadId,
      extracted?.name || null,
      extracted?.company || null,
      extracted?.phone || null,
      extracted?.store_count ?? null,
      extracted?.pos_brand || null,
      extracted?.phone_data_ready ?? null,
      extracted?.city || null,
      extracted?.cuisine || null,
      extracted?.decision_role || null,
      extracted?.member_estimate ?? null,
      extracted?.budget_range || null,
      JSON.stringify(pain),
      JSON.stringify(extracted || {}),
      controller || null,
      stage || null,
      score.intent_score,
      score.intent_level,
      JSON.stringify(tags),
      winProb,
      next.next_action,
      `${next.due_hours || 24} hours`,
      handoff_level || null,
      JSON.stringify(last_sales_decision || {}),
    ]
  );
  await persistScore(pool, leadId, score);
  for (const ev of events || []) {
    await addEvent(pool, leadId, {
      event_type: ev.event_type,
      summary: ev.summary || ev.event_type,
      evidence: ev.evidence || null,
      confidence: ev.confidence ?? 0.8,
      priority: ev.priority || 'normal',
      recommended_action: ev.recommended_action || null,
      payload: ev,
    });
  }
}

export async function ensureFollowupTask(pool, leadId, title, detail, dueHours = 24, assignee = '') {
  const dueAt = new Date(Date.now() + (dueHours || 24) * 3600000);
  return upsertTask(pool, { leadId, title, detail, dueAt, assignee });
}

export async function buildBossDailyReport(pool, { owner = '' } = {}) {
  await ensureSalesTables(pool);
  const leads = await listLeads(pool, { limit: 300 });
  const today = new Date();
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);

  const createdToday = leads.filter((l) => new Date(l.created_at) >= dayStart);
  const high = leads.filter((l) => l.intent_level === 'high');
  const waiting = leads.filter((l) => l.controller === 'waiting_human' || (l.intent_level === 'high' && l.controller === 'ai'));
  const stale = leads.filter((l) => {
    const t = l.last_human_at || l.updated_at;
    return t && Date.now() - new Date(t).getTime() > 3 * 86400000 && !['won', 'lost', 'unfit'].includes(l.stage);
  });
  const effective = leads.filter((l) => l.pain_point || (l.pain_points || []).length > 0 || l.intent_score >= 40);
  const demoCount = leads.filter((l) => (l.demo_count || 0) > 0).length;
  const quoted = leads.filter((l) => /ASK_PRICE/.test(String(JSON.stringify(l.events || []))));
  const trialCount = leads.filter((l) => l.trial_status === 'in_progress' || l.trial_status === 'completed').length;
  const won = leads.filter((l) => l.stage === 'won').length;

  const top = high.slice(0, 5).map((l) =>
    `· ${l.company || l.name || l.lead_key}｜${l.city || '?'}｜${l.store_count || '?'}店｜分${l.intent_score}｜${l.extracted?.pain_point || (l.pain_points || [])[0] || '痛点未明'}｜建议：${l.next_action || '接管'}`
  );

  const tomorrowActions = buildTomorrowActions(leads).slice(0, 5);
  const riskCustomers = buildRiskCustomers(leads).slice(0, 5);

  const text = [
    '【销售AI日报】',
    `线索总量 ${leads.length}，今日新增 ${createdToday.length}，有效沟通 ${effective.length}，高意向 ${high.length}，已询价 ${quoted.length}，已Demo ${demoCount}，试跑中 ${trialCount}，成交 ${won}。`,
    `待接管 ${waiting.length}，超3天未推进 ${stale.length}。`,
    top.length ? `最值得跟进：\n${top.join('\n')}` : '今日暂无高意向。',
    riskCustomers.length ? `风险客户：\n${riskCustomers.map((r) => `· ${r.lead_key}：${r.risks.join('、')}`).join('\n')}` : '风险客户可控。',
    tomorrowActions.length ? `明日优先行动：\n${tomorrowActions.map((a) => `· ${a.lead_key}：${a.action}`).join('\n')}` : '暂无优先行动。',
  ].join('\n');

  return {
    ok: true,
    summary: {
      total: leads.length,
      created_today: createdToday.length,
      effective: effective.length,
      high: high.length,
      waiting: waiting.length,
      stale: stale.length,
      quoted: quoted.length,
      demo_done: demoCount,
      trial: trialCount,
      won,
    },
    funnel: buildFunnelStats(leads),
    top_high: high.slice(0, 5),
    stale: stale.slice(0, 10),
    risks: riskCustomers,
    tomorrow_actions: tomorrowActions,
    text,
  };
}

export function buildFunnelStats(leads = []) {
  const stages = ['new', 'ai_greeting', 'need_identified', 'sales_takeover', 'demo_completed', 'proposal', 'trial', 'won', 'lost', 'unfit'];
  const counts = {};
  for (const s of stages) counts[s] = 0;
  for (const l of leads) {
    counts[l.stage || 'new'] = (counts[l.stage || 'new'] || 0) + 1;
  }
  return [
    { stage: '新增线索', count: counts.new + counts.ai_greeting, key: 'new' },
    { stage: '有效沟通', count: counts.need_identified, key: 'need_identified' },
    { stage: '销售接管', count: counts.sales_takeover, key: 'sales_takeover' },
    { stage: '完成Demo', count: counts.demo_completed, key: 'demo_completed' },
    { stage: '提交方案', count: counts.proposal, key: 'proposal' },
    { stage: '30天试跑', count: counts.trial, key: 'trial' },
    { stage: '正式成交', count: counts.won, key: 'won' },
  ];
}

export function buildRiskCustomers(leads = []) {
  const risks = [];
  for (const l of leads) {
    if (['won', 'lost', 'unfit'].includes(l.stage)) continue;
    const r = [];
    const lastT = l.last_human_at || l.updated_at;
    if (lastT && Date.now() - new Date(lastT).getTime() > 3 * 86400000) r.push('超3天未跟进');
    if (/ASK_PRICE/.test(String(JSON.stringify(l.events || []))) && lastT && Date.now() - new Date(lastT).getTime() > 2 * 86400000) r.push('报价后无进展');
    if (l.demo_count > 0 && l.decision_role !== '老板') r.push('已Demo但未确认决策人');
    if (!l.decision_role) r.push('未确认决策角色');
    if (l.intent_level === 'high' && l.controller === 'ai') r.push('高意向但未接管');
    if (l.extracted?.budget_range === 'low' && /ASK_PRICE/.test(String(JSON.stringify(l.events || [])))) r.push('预算敏感且已询价');
    if (r.length) risks.push({ lead_id: l.id, lead_key: l.lead_key, company: l.company || l.name || '', risks: r, priority: l.intent_level === 'high' ? 'high' : 'normal' });
  }
  return risks.sort((a, b) => (b.priority === 'high' ? 1 : -1));
}

export function buildTomorrowActions(leads = []) {
  const actions = [];
  for (const l of leads) {
    if (['won', 'lost', 'unfit'].includes(l.stage)) continue;
    if (l.intent_level === 'high' && l.controller !== 'human') {
      actions.push({ lead_id: l.id, lead_key: l.lead_key, company: l.company || l.name || '', action: '立即人工接管并约Demo', priority: 'high' });
      continue;
    }
    const due = l.next_action_due ? new Date(l.next_action_due).getTime() : 0;
    if (due && due < Date.now() + 24 * 3600000) {
      actions.push({ lead_id: l.id, lead_key: l.lead_key, company: l.company || l.name || '', action: l.next_action || '跟进', priority: l.intent_level === 'high' ? 'high' : 'normal' });
      continue;
    }
    const lastT = l.last_human_at || l.updated_at;
    if (lastT && Date.now() - new Date(lastT).getTime() > 2 * 86400000) {
      actions.push({ lead_id: l.id, lead_key: l.lead_key, company: l.company || l.name || '', action: '已2天未跟进，建议触达', priority: 'normal' });
    }
  }
  return actions.sort((a, b) => (b.priority === 'high' ? 1 : -1)).slice(0, 10);
}

export function buildSalesTodoList(leads = []) {
  const todos = [];
  for (const l of leads) {
    if (['won', 'lost', 'unfit'].includes(l.stage)) continue;
    const steps = recommendNextSteps(l);
    for (const step of steps.slice(0, 3)) {
      todos.push({
        lead_id: l.id,
        lead_key: l.lead_key,
        company: l.company || l.name || '',
        title: step,
        priority: l.intent_level === 'high' ? 'high' : (l.intent_level === 'medium' ? 'medium' : 'low'),
        due_hours: l.intent_level === 'high' ? 2 : (l.intent_level === 'medium' ? 24 : 72),
      });
    }
  }
  return todos.sort((a, b) => (b.priority === 'high' ? 1 : -1)).slice(0, 20);
}

export function recomputeFromLeadRow(lead, eventTypes = []) {
  const extracted = {
    ...(lead.extracted || {}),
    store_count: lead.store_count ?? lead.extracted?.store_count,
    pos_brand: lead.pos_brand || lead.extracted?.pos_brand,
    phone_data_ready: lead.phone_data_ready ?? lead.extracted?.phone_data_ready,
    city: lead.city || lead.extracted?.city,
    cuisine: lead.cuisine || lead.extracted?.cuisine,
    decision_role: lead.decision_role || lead.extracted?.decision_role,
    member_estimate: lead.member_estimate ?? lead.extracted?.member_estimate,
    pain_point: lead.extracted?.pain_point || (lead.pain_points || [])[0],
  };
  return scoreLead({ extracted, eventTypes });
}

export function buildTopHighLeads(leads = []) {
  return leads
    .filter((l) => !['won', 'lost', 'unfit'].includes(l.stage))
    .sort((a, b) => (b.intent_score || 0) - (a.intent_score || 0))
    .slice(0, 5)
    .map((l) => {
      const score = { intent_score: l.intent_score || 0, intent_level: l.intent_level || 'low' };
      const next = buildNextAction(l, score);
      const reasons = [];
      if (l.intent_level === 'high' && l.controller !== 'human') reasons.push('高意向待接管');
      if ((l.intent_score || 0) >= 70) reasons.push('评分≥70');
      if (l.next_action_due && new Date(l.next_action_due).getTime() < Date.now()) reasons.push('待办已到期');
      if (!reasons.length) reasons.push('优先跟进');
      return {
        lead_id: l.id,
        lead_key: l.lead_key,
        company: l.company || l.name || '',
        city: l.city || '',
        store_count: l.store_count,
        intent_score: l.intent_score,
        intent_level: l.intent_level,
        stage: l.stage,
        controller: l.controller,
        pain_point: l.extracted?.pain_point || (l.pain_points || [])[0] || '未明',
        next_action: l.next_action || next.next_action,
        win_probability: l.win_probability ?? computeWinProbability(l),
        reasons,
      };
    });
}

export { scoreLead, computeWinProbability, buildDiagnosisReport, buildDemoBrief, recommendCaseTheme, recommendAssets, recommendNextSteps, summarizeMeeting, detectOvercommitment, matchObjection, getObjectionResponse };
