/**
 * 销售 AI 后台：更新档案、任务、建议、日报
 */
import { scoreLead, persistScore } from './sales-scoring.js';
import { addEvent, ensureSalesTables, listLeads } from './sales-store.js';
import { deriveTagsForLead } from './sales-tags.js';

export function buildNextAction(lead, score) {
  if (score.intent_level === 'high' || (lead.controller === 'ai' && score.intent_score >= 70)) {
    return { next_action: '10分钟内人工接管并预约Demo', priority: 'high' };
  }
  if (!lead.store_count) return { next_action: '确认门店数量', priority: 'normal' };
  if (!lead.pain_points?.length && !lead.extracted?.pain_point) return { next_action: '确认核心经营痛点', priority: 'normal' };
  if (lead.phone_data_ready == null) return { next_action: '确认POS是否有手机号', priority: 'normal' };
  if (score.intent_level === 'medium') return { next_action: '发送匹配案例并约演示', priority: 'medium' };
  return { next_action: '保持轻触达，补齐关键信息', priority: 'low' };
}

export function buildSalesAdvice(lead, score) {
  const pain = lead.extracted?.pain_point || (lead.pain_points || [])[0] || '未明确';
  const lines = [
    `意向 ${score.intent_score}（${score.intent_level}）`,
    `痛点优先讲：${pain}`,
    '禁止承诺：全POS可接 / 定制 / 私自折扣 / 保证效果',
  ];
  if (score.intent_level === 'high') lines.push('建议立即接管，先确认决策人与Demo时间');
  if (lead.phone_data_ready === false) lines.push('风险：数据基础弱，先谈可行性再报价');
  return lines.join('\n');
}

export async function applyLeadUpdates(pool, leadId, { extracted, events, score, controller, stage }) {
  await ensureSalesTables(pool);
  const pain = extracted?.pain_point ? [extracted.pain_point] : [];
  const tags = deriveTagsForLead({
    store_count: extracted?.store_count,
    phone_data_ready: extracted?.phone_data_ready,
    pain_point: extracted?.pain_point,
    stage: stage || null,
    intent_level: score.intent_level,
  });
  await pool.query(
    `UPDATE sales_leads SET
        store_count = COALESCE($2, store_count),
        pos_brand = COALESCE($3, pos_brand),
        phone_data_ready = COALESCE($4, phone_data_ready),
        city = COALESCE($5, city),
        cuisine = COALESCE($6, cuisine),
        decision_role = COALESCE($7, decision_role),
        member_estimate = COALESCE($8, member_estimate),
        pain_points = CASE WHEN $9::jsonb = '[]'::jsonb THEN pain_points ELSE $9::jsonb END,
        extracted = COALESCE(extracted,'{}'::jsonb) || $10::jsonb,
        controller = COALESCE($11, controller),
        stage = COALESCE($12, stage),
        intent_score = $13,
        intent_level = $14,
        tags = $15::jsonb,
        last_message_at = NOW(),
        updated_at = NOW()
      WHERE id=$1`,
    [
      leadId,
      extracted?.store_count ?? null,
      extracted?.pos_brand || null,
      extracted?.phone_data_ready ?? null,
      extracted?.city || null,
      extracted?.cuisine || null,
      extracted?.decision_role || null,
      extracted?.member_estimate ?? null,
      JSON.stringify(pain),
      JSON.stringify(extracted || {}),
      controller || null,
      stage || null,
      score.intent_score,
      score.intent_level,
      JSON.stringify(tags),
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

export async function ensureFollowupTask(pool, leadId, title, detail) {
  const exist = await pool.query(
    `SELECT id FROM sales_tasks WHERE lead_id=$1 AND status='open' AND title=$2 LIMIT 1`,
    [leadId, title]
  );
  if (exist.rows?.length) return exist.rows[0];
  const r = await pool.query(
    `INSERT INTO sales_tasks (lead_id, title, detail, due_at)
     VALUES ($1,$2,$3, NOW() + INTERVAL '1 day') RETURNING *`,
    [leadId, title, detail || null]
  );
  return r.rows[0];
}

export async function buildBossDailyReport(pool) {
  await ensureSalesTables(pool);
  const leads = await listLeads(pool, { limit: 200 });
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

  const top = high.slice(0, 5).map((l) =>
    `· ${l.company || l.name || l.lead_key}｜${l.city || '?'}｜${l.store_count || '?'}店｜分${l.intent_score}｜${l.extracted?.pain_point || (l.pain_points || [])[0] || '痛点未明'}`
  );

  const text = [
    '【销售AI日报】',
    `线索总量 ${leads.length}，今日新增 ${createdToday.length}，高意向 ${high.length}，待接管 ${waiting.length}，超3天未推进 ${stale.length}`,
    top.length ? `最值得跟进：\n${top.join('\n')}` : '今日暂无高意向。',
    stale.length ? `漏跟风险：${stale.slice(0, 3).map((l) => l.lead_key).join('、')}` : '漏跟风险可控。',
  ].join('\n');

  return {
    ok: true,
    summary: {
      total: leads.length,
      created_today: createdToday.length,
      high: high.length,
      waiting: waiting.length,
      stale: stale.length,
    },
    top_high: high.slice(0, 5),
    stale: stale.slice(0, 10),
    text,
  };
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

export { scoreLead };
