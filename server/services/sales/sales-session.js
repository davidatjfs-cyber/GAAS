/**
 * 销售会话编排：建档 → 客户AI → 评分 → 接管/任务
 */
import {
  ensureSalesTables,
  newLeadKey,
  getLead,
  addMessage,
  listMessages,
  addEvent,
} from './sales-store.js';
import { runCustomerAiTurn } from './sales-customer-ai.js';
import {
  applyLeadUpdates,
  buildNextAction,
  buildSalesAdvice,
  ensureFollowupTask,
  scoreLead,
} from './sales-ops.js';

let _notify = null;
export function setSalesNotify(fn) {
  _notify = fn;
}

async function upsertConversation(pool, { openKfid, externalUserid, leadId }) {
  const existing = await pool.query(
    `SELECT * FROM sales_conversations
      WHERE open_kfid IS NOT DISTINCT FROM $1 AND external_userid IS NOT DISTINCT FROM $2
      ORDER BY id DESC LIMIT 1`,
    [openKfid || null, externalUserid || null]
  );
  if (existing.rows?.[0]) return existing.rows[0];
  const r = await pool.query(
    `INSERT INTO sales_conversations (lead_id, open_kfid, external_userid, controller)
     VALUES ($1,$2,$3,'ai') RETURNING *`,
    [leadId, openKfid || null, externalUserid || null]
  );
  return r.rows[0];
}

async function upsertLead(pool, { openKfid, externalUserid, sourceChannel }) {
  if (externalUserid) {
    const found = await pool.query(
      `SELECT * FROM sales_leads WHERE external_userid=$1 ORDER BY id DESC LIMIT 1`,
      [externalUserid]
    );
    if (found.rows?.[0]) return found.rows[0];
  }
  const key = newLeadKey();
  const r = await pool.query(
    `INSERT INTO sales_leads (lead_key, external_userid, open_kfid, source_channel, stage, controller)
     VALUES ($1,$2,$3,$4,'ai_greeting','ai') RETURNING *`,
    [key, externalUserid || null, openKfid || null, sourceChannel || 'wecom_kf']
  );
  return r.rows[0];
}

/**
 * 处理一条入站客户消息（微信客服或沙盒）
 */
export async function handleInboundMessage(pool, {
  text,
  openKfid = 'sandbox',
  externalUserid,
  msgId,
  sourceChannel = 'sandbox',
  welcome = false,
} = {}) {
  await ensureSalesTables(pool);
  const content = String(text || '').trim();
  if (!content && !welcome) return { ok: false, error: 'empty_message' };

  const lead = await upsertLead(pool, { openKfid, externalUserid: externalUserid || `sandbox_${Date.now()}`, sourceChannel });
  const conv = await upsertConversation(pool, { openKfid, externalUserid: lead.external_userid, leadId: lead.id });

  // 人工控场：只记录客户消息，不自动回复
  if (conv.controller === 'human') {
    if (content) {
      await addMessage(pool, {
        conversationId: conv.id,
        leadId: lead.id,
        direction: 'inbound',
        sender: 'customer',
        content,
        msgId,
      });
    }
    await pool.query(`UPDATE sales_leads SET last_message_at=NOW(), updated_at=NOW() WHERE id=$1`, [lead.id]);
    return {
      ok: true,
      replied: false,
      reason: 'human_controller',
      lead_id: lead.id,
      conversation_id: conv.id,
    };
  }

  if (welcome && !content) {
    const welcomeText = '您好，我是餐厅AI增长顾问。我可以介绍客户自动维护、门店自主运营和人才培养。请问您目前有几家门店？';
    await addMessage(pool, {
      conversationId: conv.id,
      leadId: lead.id,
      direction: 'outbound',
      sender: 'ai',
      content: welcomeText,
      meta: { kind: 'welcome' },
    });
    return {
      ok: true,
      replied: true,
      reply: welcomeText,
      lead_id: lead.id,
      conversation_id: conv.id,
      controller: 'ai',
    };
  }

  await addMessage(pool, {
    conversationId: conv.id,
    leadId: lead.id,
    direction: 'inbound',
    sender: 'customer',
    content,
    msgId,
  });

  const history = await listMessages(pool, conv.id, 30);
  const turn = await runCustomerAiTurn({
    userText: content,
    extracted: lead.extracted || {},
    history,
    intentScore: lead.intent_score || 0,
    controller: conv.controller,
  });

  const eventTypes = (turn.plan.events || []).map((e) => e.event_type);
  const score = scoreLead({ extracted: turn.plan.extracted, eventTypes });
  const takeover = turn.plan.takeover?.takeover;
  const nextController = takeover ? 'waiting_human' : conv.controller;
  const nextStage = takeover ? 'qualified' : (lead.stage === 'new' || lead.stage === 'ai_greeting' ? 'need_identified' : lead.stage);

  await applyLeadUpdates(pool, lead.id, {
    extracted: turn.plan.extracted,
    events: (turn.plan.events || []).map((e) => ({
      ...e,
      evidence: content.slice(0, 200),
      summary: e.event_type,
    })),
    score,
    controller: nextController,
    stage: nextStage,
  });

  const advice = buildSalesAdvice({ ...lead, extracted: turn.plan.extracted, phone_data_ready: turn.plan.extracted.phone_data_ready }, score);
  const next = buildNextAction({ ...lead, extracted: turn.plan.extracted, controller: nextController }, score);
  await pool.query(
    `UPDATE sales_leads SET next_action=$2, updated_at=NOW() WHERE id=$1`,
    [lead.id, next.next_action]
  );

  if (takeover) {
    await pool.query(
      `UPDATE sales_conversations SET controller='waiting_human', updated_at=NOW() WHERE id=$1`,
      [conv.id]
    );
    await ensureFollowupTask(pool, lead.id, '高意向客户待接管', advice);
    await addEvent(pool, lead.id, {
      event_type: 'HANDOFF_REQUESTED',
      summary: turn.plan.takeover.reason,
      evidence: content.slice(0, 200),
      priority: 'high',
      recommended_action: 'takeover',
      payload: { score, advice },
    });
    if (typeof _notify === 'function') {
      await _notify(
        [
          '【销售AI·高意向待接管】',
          `线索 ${lead.lead_key}`,
          `评分 ${score.intent_score}（${score.intent_level}）`,
          `门店 ${turn.plan.extracted.store_count ?? '未明'}｜痛点 ${turn.plan.extracted.pain_point || '未明'}`,
          `原因：${turn.plan.takeover.reason}`,
          advice,
        ].join('\n'),
        { title: '高意向销售线索', audience: 'sales' }
      ).catch(() => null);
    }
  }

  await addMessage(pool, {
    conversationId: conv.id,
    leadId: lead.id,
    direction: 'outbound',
    sender: 'ai',
    content: turn.reply,
    meta: { source: turn.source, mode: turn.plan.mode },
  });

  return {
    ok: true,
    replied: true,
    reply: turn.reply,
    lead_id: lead.id,
    conversation_id: conv.id,
    controller: nextController,
    score,
    advice,
    next_action: next.next_action,
    plan: {
      mode: turn.plan.mode,
      extracted: turn.plan.extracted,
      takeover: turn.plan.takeover,
      events: turn.plan.events,
    },
    source: turn.source,
  };
}

export async function takeoverConversation(pool, leadId, { ownerUsername } = {}) {
  await ensureSalesTables(pool);
  const lead = await getLead(pool, leadId);
  if (!lead) return { ok: false, error: 'not_found' };
  await pool.query(
    `UPDATE sales_leads
        SET controller='human', stage=CASE WHEN stage IN ('new','ai_greeting','need_identified','qualified') THEN 'sales_takeover' ELSE stage END,
            owner_username=COALESCE($2, owner_username), last_human_at=NOW(), updated_at=NOW()
      WHERE id=$1`,
    [leadId, ownerUsername || null]
  );
  await pool.query(
    `UPDATE sales_conversations SET controller='human', updated_at=NOW() WHERE lead_id=$1 AND status='open'`,
    [leadId]
  );
  await addEvent(pool, leadId, {
    event_type: 'HUMAN_TAKEOVER',
    summary: `由 ${ownerUsername || 'sales'} 接管`,
    priority: 'high',
    recommended_action: 'continue_human',
  });
  const notice = '您好，我是人工顾问，已接过沟通。接下来我结合您的门店情况具体说明。';
  const conv = await pool.query(
    `SELECT id FROM sales_conversations WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`,
    [leadId]
  );
  if (conv.rows?.[0]) {
    await addMessage(pool, {
      conversationId: conv.rows[0].id,
      leadId,
      direction: 'outbound',
      sender: 'human',
      content: notice,
      meta: { kind: 'takeover_notice' },
    });
  }
  return { ok: true, lead_id: leadId, notice };
}

export async function releaseToAi(pool, leadId) {
  await pool.query(
    `UPDATE sales_leads SET controller='ai', updated_at=NOW() WHERE id=$1`,
    [leadId]
  );
  await pool.query(
    `UPDATE sales_conversations SET controller='ai', updated_at=NOW() WHERE lead_id=$1 AND status='open'`,
    [leadId]
  );
  return { ok: true };
}

export async function getLeadDetail(pool, leadId) {
  await ensureSalesTables(pool);
  const lead = await getLead(pool, leadId);
  if (!lead) return { ok: false, error: 'not_found' };
  const conv = await pool.query(
    `SELECT * FROM sales_conversations WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`,
    [leadId]
  );
  const messages = conv.rows?.[0] ? await listMessages(pool, conv.rows[0].id, 100) : [];
  const events = await pool.query(
    `SELECT * FROM sales_lead_events WHERE lead_id=$1 ORDER BY id DESC LIMIT 50`,
    [leadId]
  );
  const scores = await pool.query(
    `SELECT * FROM sales_score_items WHERE lead_id=$1 ORDER BY id ASC`,
    [leadId]
  );
  const tasks = await pool.query(
    `SELECT * FROM sales_tasks WHERE lead_id=$1 ORDER BY id DESC LIMIT 20`,
    [leadId]
  );
  const score = {
    intent_score: lead.intent_score,
    intent_level: lead.intent_level,
    items: scores.rows || [],
  };
  return {
    ok: true,
    lead,
    conversation: conv.rows?.[0] || null,
    messages,
    events: events.rows || [],
    score,
    tasks: tasks.rows || [],
    advice: buildSalesAdvice(lead, score),
    next_action: lead.next_action || buildNextAction(lead, score).next_action,
  };
}
