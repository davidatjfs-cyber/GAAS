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
  upsertTask,
  loadLeadFunnel,
  saveSalesGuidance,
  transitionLeadStage,
  getActiveSalesGuidance,
} from './sales-store.js';
import { runCustomerAiTurn } from './sales-customer-ai.js';
import { loadKnowledgeItems } from './sales-knowledge-store.js';
import { extractSlotsFromText, detectEvents } from './sales-strategy.js';
import {
  applyLeadUpdates,
  buildNextAction,
  buildSalesAdvice,
  ensureFollowupTask,
  scoreLead,
  buildDiagnosisReport,
  detectOvercommitment,
  matchObjection,
  getObjectionResponse,
} from './sales-ops.js';
import { buildSalesDecision, buildCustomerAiGuidance, normalizeCustomerAiEvent } from './sales-collaboration.js';
import { kfConfigured, sendKfConsultantCard } from './sales-kf.js';
import { sendContentAssetToLead } from './sales-content-delivery.js';

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
  try {
    // idx_sales_conv_ext_kf 是(open_kfid,external_userid)都非空时的部分唯一索引；两个并发
    // 请求同时给同一客户建会话时，靠这个索引兜底只留一行，不再是SELECT没查到就直接抛冲突异常。
    const r = await pool.query(
      `INSERT INTO sales_conversations (lead_id, open_kfid, external_userid, controller)
       VALUES ($1,$2,$3,'ai')
       ON CONFLICT (open_kfid, external_userid) WHERE open_kfid IS NOT NULL AND external_userid IS NOT NULL DO NOTHING
       RETURNING *`,
      [leadId, openKfid || null, externalUserid || null]
    );
    if (r.rows?.[0]) return r.rows[0];
  } catch (e) {
    if (!/no unique or exclusion constraint/i.test(e?.message || '')) throw e;
    const r = await pool.query(
      `INSERT INTO sales_conversations (lead_id, open_kfid, external_userid, controller)
       VALUES ($1,$2,$3,'ai') RETURNING *`,
      [leadId, openKfid || null, externalUserid || null]
    );
    return r.rows[0];
  }
  const found = await pool.query(
    `SELECT * FROM sales_conversations
      WHERE open_kfid IS NOT DISTINCT FROM $1 AND external_userid IS NOT DISTINCT FROM $2
      ORDER BY id DESC LIMIT 1`,
    [openKfid || null, externalUserid || null]
  );
  return found.rows?.[0] || null;
}

/**
 * 同一客户几乎同时发两条消息会并发触发两次调用；靠 idx_sales_leads_external_uid 这个
 * 部分唯一索引兜底，INSERT ... ON CONFLICT DO NOTHING 后如果没插进去就查回已存在的那条，
 * 不会像之前"先SELECT再INSERT"那样在竞态下拆出两条lead_key不同的重复线索。
 */
async function upsertLead(pool, { openKfid, externalUserid, sourceChannel }) {
  if (externalUserid) {
    const found = await pool.query(
      `SELECT * FROM sales_leads WHERE external_userid=$1 ORDER BY id DESC LIMIT 1`,
      [externalUserid]
    );
    if (found.rows?.[0]) return found.rows[0];
  }
  const key = newLeadKey();
  try {
    const r = await pool.query(
      `INSERT INTO sales_leads (lead_key, external_userid, open_kfid, source_channel, stage, controller)
       VALUES ($1,$2,$3,$4,'ai_greeting','ai')
       ON CONFLICT (external_userid) WHERE external_userid IS NOT NULL DO NOTHING
       RETURNING *`,
      [key, externalUserid || null, openKfid || null, sourceChannel || 'wecom_kf']
    );
    if (r.rows?.[0]) return r.rows[0];
    const existing = await pool.query(
      `SELECT * FROM sales_leads WHERE external_userid=$1 ORDER BY id DESC LIMIT 1`,
      [externalUserid]
    );
    return existing.rows?.[0] || null;
  } catch (e) {
    // idx_sales_leads_external_uid 可能因历史重复数据未清理而尚未建成，过渡期退回无约束的
    // 普通INSERT，去重保护降级但不阻断新客户建档。
    if (!/no unique or exclusion constraint/i.test(e?.message || '')) throw e;
    const r = await pool.query(
      `INSERT INTO sales_leads (lead_key, external_userid, open_kfid, source_channel, stage, controller)
       VALUES ($1,$2,$3,$4,'ai_greeting','ai') RETURNING *`,
      [key, externalUserid || null, openKfid || null, sourceChannel || 'wecom_kf']
    );
    return r.rows[0];
  }
}

export function buildWaitingHumanBridgeReply({ content, lead = {} } = {}) {
  const text = String(content || '').trim();
  if (/^(?:你|您)?还?在吗[？?]?$/.test(text)) {
    return '在的，人工顾问正在接手，但我不会让您在这里空等。您继续发问就行，我会先回答并把信息同步给顾问。';
  }
  const company = String(lead.company || lead.extracted?.company || '').trim();
  if (/还记得.{0,12}(?:公司|品牌)|我是哪家公司/.test(text)) {
    if (company) return `记得，您是${company}。我会把这个信息一起同步给接手顾问。`;
    return '公司或品牌名称我这边还没有记录到，不会随便猜。您把品牌名发我，我马上补上并同步给顾问。';
  }
  return '收到，我还在这里，也已经把您这条新信息同步给接手顾问。顾问回复前，您继续问就行，我会先接着回答。';
}

async function pauseAutoNurtureOnCustomerReply(pool, leadId) {
  const r = await pool.query(
    `UPDATE sales_leads
        SET auto_nurture_enabled=false,auto_nurture_paused_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND auto_nurture_enabled=true
      RETURNING id`,
    [leadId]
  );
  if (r.rowCount) {
    await addEvent(pool, leadId, {
      event_type: 'AUTO_NURTURE_PAUSED_BY_REPLY',
      summary: '客户已回复，自动培育已暂停，等待销售重新确认',
      priority: 'normal',
      recommended_action: 'review_customer_reply',
    });
  }
}

export async function handleInboundMessage(pool, {
  text,
  openKfid = 'sandbox',
  externalUserid,
  msgId,
  sourceChannel = 'sandbox',
  welcome = false,
  inputMode = 'text',
} = {}) {
  await ensureSalesTables(pool);
  const content = String(text || '').trim();
  if (!content && !welcome) return { ok: false, error: 'empty_message' };

  const lead = await upsertLead(pool, { openKfid, externalUserid: externalUserid || `sandbox_${Date.now()}`, sourceChannel });
  const conv = await upsertConversation(pool, { openKfid, externalUserid: lead.external_userid, leadId: lead.id });

  if (conv.controller === 'human') {
    if (content) {
      const m = await addMessage(pool, {
        conversationId: conv.id,
        leadId: lead.id,
        direction: 'inbound',
        sender: 'customer',
        content,
        msgId,
        meta: { input_mode: inputMode },
      });
      if (msgId && !m.inserted) {
        return { ok: true, replied: false, reason: 'duplicate_message', lead_id: lead.id, conversation_id: conv.id };
      }
      await pauseAutoNurtureOnCustomerReply(pool, lead.id);
    }
    await pool.query(`UPDATE sales_leads SET last_message_at=NOW(), updated_at=NOW() WHERE id=$1`, [lead.id]);
    return { ok: true, replied: false, reason: 'human_controller', lead_id: lead.id, conversation_id: conv.id };
  }

  if (conv.controller === 'waiting_human') {
    let inboundMsg = null;
    if (content) {
      inboundMsg = await addMessage(pool, {
        conversationId: conv.id,
        leadId: lead.id,
        direction: 'inbound',
        sender: 'customer',
        content,
        msgId,
        meta: { input_mode: inputMode },
      });
      if (msgId && !inboundMsg.inserted) {
        return { ok: true, replied: false, reason: 'duplicate_message', lead_id: lead.id, conversation_id: conv.id, controller: 'waiting_human' };
      }
      await pauseAutoNurtureOnCustomerReply(pool, lead.id);
    }
    const slots = extractSlotsFromText(content, lead.extracted || {});
    const events = detectEvents(content);
    const eventTypes = events.map((e) => e.event_type);
    const score = scoreLead({ extracted: slots, eventTypes });
    await applyLeadUpdates(pool, lead.id, {
      extracted: slots,
      events: events.map((e) => ({ ...e, evidence: content.slice(0, 200), summary: e.event_type })),
      score,
      controller: 'waiting_human',
    });
    const updatedLead = await getLead(pool, lead.id);
    const advice = buildSalesAdvice(updatedLead, score);
    const diagnosis = buildDiagnosisReport(updatedLead);
    const history = (await listMessages(pool, conv.id, 30)).filter((m) => m.id !== inboundMsg?.id);
    const knowledgeItems = await loadKnowledgeItems(pool);
    const mergedProfile = {
      ...(updatedLead.extracted || slots || {}),
      name: updatedLead.name || updatedLead.extracted?.name || undefined,
      company: updatedLead.company || updatedLead.extracted?.company || undefined,
      phone: updatedLead.phone || updatedLead.extracted?.phone || undefined,
      contact_phone: updatedLead.phone || updatedLead.extracted?.contact_phone || undefined,
    };
    const turn = await runCustomerAiTurn({
      userText: content,
      extracted: mergedProfile,
      history,
      intentScore: score.intent_score,
      controller: 'waiting_human',
      knowledgeItems,
      pool,
      inputMode,
    }).catch(() => null);
    const reply = turn?.reply || buildWaitingHumanBridgeReply({ content, lead: updatedLead });
    await addMessage(pool, {
      conversationId: conv.id,
      leadId: lead.id,
      direction: 'outbound',
      sender: 'ai',
      content: reply,
      meta: { source: turn?.source || 'waiting_human_bridge_fallback', mode: 'waiting_human_bridge' },
    });
    await addEvent(pool, lead.id, {
      event_type: 'CUSTOMER_FOLLOWUP_WAITING_HUMAN',
      summary: '客户在等待人工时继续追问',
      evidence: content.slice(0, 200),
      priority: 'high',
      recommended_action: 'takeover',
    });
    if (typeof _notify === 'function') {
      await _notify(
        ['【销售AI·待接管客户继续追问】', `线索 ${lead.lead_key}`, `客户：${content.slice(0, 160)}`, '请尽快人工接管，AI已先行回应防止冷场。'].join('\n'),
        { title: '待接管客户继续追问', audience: 'sales' }
      ).catch(() => null);
    }
    await pool.query(`UPDATE sales_leads SET last_message_at=NOW(), updated_at=NOW() WHERE id=$1`, [lead.id]);
    return {
      ok: true,
      replied: true,
      reply,
      reason: 'waiting_human_bridge',
      lead_id: lead.id,
      conversation_id: conv.id,
      controller: 'waiting_human',
      score,
      advice,
      diagnosis,
      source: turn?.source || 'waiting_human_bridge_fallback',
      plan: { extracted: slots, events },
    };
  }

  if (welcome && !content) {
    const already = await pool.query(
      `SELECT id FROM sales_messages WHERE conversation_id=$1 AND meta->>'kind'='welcome' LIMIT 1`,
      [conv.id]
    );
    if (already.rows?.length) {
      return { ok: true, replied: false, reason: 'already_welcomed', lead_id: lead.id, conversation_id: conv.id, controller: 'ai' };
    }
    const welcomeText = '您好，我是李娟娟，负责餐厅经营顾问这块。可以聊聊客户维护、门店管理或者人才培养这些，您目前有几家门店？';
    await addMessage(pool, {
      conversationId: conv.id,
      leadId: lead.id,
      direction: 'outbound',
      sender: 'ai',
      content: welcomeText,
      meta: { kind: 'welcome' },
    });
    return { ok: true, replied: true, reply: welcomeText, lead_id: lead.id, conversation_id: conv.id, controller: 'ai' };
  }

  const inboundMsg = await addMessage(pool, {
    conversationId: conv.id,
    leadId: lead.id,
    direction: 'inbound',
    sender: 'customer',
    content,
    msgId,
    meta: { input_mode: inputMode },
  });
  if (msgId && !inboundMsg.inserted) {
    // 企微/cron重推了同一条消息：这条inbound记录已经处理过，不再重跑评分/LLM回复/线索更新/
    // 通知——否则客户会收到两条几乎相同的AI回复，销售会收到重复的高意向通知。
    return { ok: true, replied: false, reason: 'duplicate_message', lead_id: lead.id, conversation_id: conv.id, controller: conv.controller };
  }
  await pauseAutoNurtureOnCustomerReply(pool, lead.id);

  // 当前 inbound 已写入数据库，但不能又作为“历史”传给模型，否则同一句会同时出现在
  // 历史和“客户本轮说”两个位置，放大模型对重复话术的关注。
  const history = (await listMessages(pool, conv.id, 30)).filter((m) => m.id !== inboundMsg.id);
  const activeGuidanceRow = await getActiveSalesGuidance(pool, lead.id);
  const activeGuidance = activeGuidanceRow?.guidance || null;
  const knowledgeItems = await loadKnowledgeItems(pool);
  const turn = await runCustomerAiTurn({
    userText: content,
    extracted: lead.extracted || {},
    history,
    intentScore: lead.intent_score || 0,
    controller: conv.controller,
    guidance: activeGuidance,
    knowledgeItems,
    pool,
    inputMode,
  });

  const normalizedEvents = (turn.plan.events || []).map((e) => normalizeCustomerAiEvent(e, content));
  const eventTypes = normalizedEvents.map((e) => e.event_type);
  const score = scoreLead({ extracted: turn.plan.extracted, eventTypes });
  const decision = buildSalesDecision({ lead: { ...lead, extracted: turn.plan.extracted }, score, events: normalizedEvents });
  const takeover = decision.controller_recommendation === 'handoff_now';
  const nextController = takeover ? 'waiting_human' : conv.controller;
  const nextStage = decision.sales_stage;

  await applyLeadUpdates(pool, lead.id, {
    extracted: turn.plan.extracted,
    events: normalizedEvents,
    score,
    controller: nextController,
    handoff_level: decision.intent_level,
    last_sales_decision: decision,
  });

  const updatedLead = await getLead(pool, lead.id);
  const advice = buildSalesAdvice(updatedLead, score);
  const next = buildNextAction(updatedLead, score);
  const diagnosis = buildDiagnosisReport(updatedLead);
  const customerGuidance = buildCustomerAiGuidance(decision);
  await saveSalesGuidance(pool, { leadId: lead.id, conversationId: conv.id, guidance: customerGuidance, expiresInTurns: customerGuidance.expires_in_turns });
  if (nextStage && nextStage !== lead.stage) {
    const stageResult = await transitionLeadStage(pool, {
      leadId: lead.id,
      toStage: nextStage,
      actorType: 'customer_ai',
      actorId: conv.session_key || String(conv.id),
      reason: decision.next_action,
      sourceType: 'customer_ai_session',
      sourceId: String(conv.id),
      metadata: { score, events: normalizedEvents },
    });
    if (!stageResult.ok) {
      console.warn('[sales-session] customer AI stage transition rejected', { leadId: lead.id, from: lead.stage, to: nextStage, error: stageResult.error });
      await addEvent(pool, lead.id, { event_type: 'STAGE_TRANSITION_REJECTED', summary: stageResult.error, priority: 'normal', recommended_action: 'continue', payload: { from_stage: lead.stage, to_stage: nextStage } });
    }
  }

  if (takeover) {
    await pool.query(`UPDATE sales_conversations SET controller='waiting_human', updated_at=NOW() WHERE id=$1`, [conv.id]);
    await ensureFollowupTask(pool, lead.id, '高意向客户待接管', advice, 0.2);
    await addEvent(pool, lead.id, {
      event_type: 'HANDOFF_REQUESTED',
      summary: turn.plan.takeover.reason,
      evidence: content.slice(0, 200),
      priority: 'high',
      recommended_action: 'takeover',
      payload: { score, advice, diagnosis },
    });
    // 多销售按当前开放线索数最少者自动分配；同负载时按销售ID轮询，避免永远分给第一人。
    let handoffLead = updatedLead;
    if (!handoffLead.assigned_to) {
      const rep = await pool.query(
        `SELECT r.rep_key FROM sales_reps r
          LEFT JOIN sales_leads l ON (l.assigned_to=r.rep_key OR l.owner_username=r.rep_key) AND l.stage NOT IN ('won','lost','unfit')
         WHERE r.status='active' AND r.role IN ('sales','sales_manager')
         GROUP BY r.id,r.rep_key,r.region_code
         ORDER BY CASE WHEN $1::text IS NOT NULL AND r.region_code=$1 THEN 0 WHEN r.region_code IS NULL THEN 1 ELSE 2 END,
                  COUNT(l.id) ASC,r.id ASC LIMIT 1`,
        [handoffLead.region_code || null]
      ).catch(() => ({ rows: [] }));
      if (rep.rows?.[0]?.rep_key) {
        await pool.query(`UPDATE sales_leads SET assigned_to=$2,assigned_at=NOW(),updated_at=NOW() WHERE id=$1 AND assigned_to IS NULL`, [lead.id, rep.rows[0].rep_key]);
        handoffLead = { ...handoffLead, assigned_to: rep.rows[0].rep_key };
      }
    }
    // 客户AI完成人格化接待与判断后，明确把客户交给具名顾问；不让销售继续假扮AI客服。
    const qrUrl = String(process.env.WECOM_SALES_CONSULTANT_QR_URL || '').trim();
    if (handoffLead.handoff_mode === 'consultant_qr' && kfConfigured() && handoffLead.open_kfid && handoffLead.external_userid) {
      try {
        const rep = handoffLead.assigned_to ? await pool.query(`SELECT r.wecom_name,a.* FROM sales_reps r LEFT JOIN sales_content_assets a ON a.id=r.wecom_qr_asset_id WHERE r.rep_key=$1 AND r.status='active' LIMIT 1`, [handoffLead.assigned_to]) : { rows: [] };
        const repAsset = rep.rows?.[0]?.id ? rep.rows[0] : null;
        const card = repAsset
          ? await sendContentAssetToLead(pool, handoffLead, repAsset, { deliveryType: 'handoff', sentBy: 'customer_ai' })
          : qrUrl ? await sendKfConsultantCard({ openKfid: handoffLead.open_kfid, externalUserid: handoffLead.external_userid, consultantName: process.env.WECOM_SALES_CONSULTANT_NAME || '专属顾问', qrUrl }) : null;
        if (card?.ok) await addEvent(pool, lead.id, { event_type: 'CONSULTANT_QR_SENT', summary: '客户AI已发送专属销售企业微信二维码', priority: 'high', recommended_action: 'wait_customer_add' });
      } catch (e) {
        console.warn('[sales-session] consultant QR handoff failed:', e?.message || e);
      }
    }
    if (typeof _notify === 'function') {
      await _notify(
        [
          '【销售AI·高意向待接管】',
          `线索 ${lead.lead_key}`,
          `评分 ${score.intent_score}（${score.intent_level}）`,
          `门店 ${turn.plan.extracted.store_count ?? '未明'}｜痛点 ${turn.plan.extracted.pain_point || '未明'}`,
          `原因：${decision.next_action}`,
          advice,
          `诊断：${diagnosis.surface_problem}`,
        ].join('\n'),
        { title: '高意向销售线索', audience: 'sales' }
      ).catch(() => null);
    }
  } else if (next.priority === 'medium' && !updatedLead.next_action) {
    await ensureFollowupTask(pool, lead.id, next.next_action, advice, next.due_hours || 48);
  }

  await addMessage(pool, {
    conversationId: conv.id,
    leadId: lead.id,
    direction: 'outbound',
    sender: 'ai',
    content: turn.reply,
    meta: { source: turn.source, mode: turn.plan.mode },
  });

  await pool.query(
    `UPDATE sales_leads SET first_response_at=COALESCE(first_response_at, NOW()), first_contact_at=COALESCE(first_contact_at, NOW()), updated_at=NOW() WHERE id=$1`,
    [lead.id]
  );

  return {
    ok: true,
    replied: true,
    reply: turn.reply,
    lead_id: lead.id,
    conversation_id: conv.id,
    controller: nextController,
    score,
    advice,
    diagnosis,
    next_action: next.next_action,
    plan: { mode: turn.plan.mode, extracted: turn.plan.extracted, takeover: turn.plan.takeover, events: normalizedEvents },
    sales_decision: decision,
    customer_ai_guidance: customerGuidance,
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
            owner_username=COALESCE($2, owner_username), assigned_to=COALESCE($2, assigned_to), handoff_at=COALESCE(handoff_at, NOW()), last_human_at=NOW(), first_human_response_at=COALESCE(first_human_response_at, NOW()), sla_status='met', updated_at=NOW()
      WHERE id=$1`,
    [leadId, ownerUsername || null]
  );
  await pool.query(`UPDATE sales_conversations SET controller='human', updated_at=NOW() WHERE lead_id=$1 AND status='open'`, [leadId]);
  await addEvent(pool, leadId, { event_type: 'HUMAN_TAKEOVER', summary: `由 ${ownerUsername || 'sales'} 接管`, priority: 'high', recommended_action: 'continue_human' });
  const notice = '您好，我是人工顾问，已接过沟通。接下来我结合您的门店情况具体说明。';
  const conv = await pool.query(`SELECT id FROM sales_conversations WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [leadId]);
  if (conv.rows?.[0]) {
    await addMessage(pool, { conversationId: conv.rows[0].id, leadId, direction: 'outbound', sender: 'human', content: notice, meta: { kind: 'takeover_notice' } });
  }
  return { ok: true, lead_id: leadId, notice };
}

export async function releaseToAi(pool, leadId) {
  await pool.query(`UPDATE sales_leads SET controller='ai', updated_at=NOW() WHERE id=$1`, [leadId]);
  await pool.query(`UPDATE sales_conversations SET controller='ai', updated_at=NOW() WHERE lead_id=$1 AND status='open'`, [leadId]);
  return { ok: true };
}

export async function getLeadDetail(pool, leadId) {
  await ensureSalesTables(pool);
  const lead = await getLead(pool, leadId);
  if (!lead) return { ok: false, error: 'not_found' };
  const conv = await pool.query(`SELECT * FROM sales_conversations WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [leadId]);
  const messages = conv.rows?.[0] ? await listMessages(pool, conv.rows[0].id, 100) : [];
  const events = await pool.query(`SELECT * FROM sales_lead_events WHERE lead_id=$1 ORDER BY id DESC LIMIT 50`, [leadId]);
  const scores = await pool.query(`SELECT * FROM sales_score_items WHERE lead_id=$1 ORDER BY id ASC`, [leadId]);
  const score = { intent_score: lead.intent_score, intent_level: lead.intent_level, items: scores.rows || [] };
  const funnel = await loadLeadFunnel(pool, leadId);
  const diagnosis = buildDiagnosisReport(lead);
  return {
    ok: true,
    lead,
    conversation: conv.rows?.[0] || null,
    messages,
    events: events.rows || [],
    score,
    tasks: funnel.tasks,
    opportunities: funnel.opportunities,
    demos: funnel.demos,
    meetings: funnel.meetings,
    trials: funnel.trials,
    deals: funnel.deals,
    objections: funnel.objections,
    loss_reasons: funnel.loss_reasons,
    advice: buildSalesAdvice(lead, score),
    next_action: lead.next_action || buildNextAction(lead, score).next_action,
    diagnosis,
  };
}

export async function recordSalesReply(pool, leadId, text, { sender = 'human' } = {}) {
  await ensureSalesTables(pool);
  const lead = await getLead(pool, leadId);
  if (!lead) return { ok: false, error: 'not_found' };
  const conv = await pool.query(`SELECT * FROM sales_conversations WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [leadId]);
  if (!conv.rows?.[0]) return { ok: false, error: 'no_conversation' };
  await addMessage(pool, { conversationId: conv.rows[0].id, leadId, direction: 'outbound', sender, content: text });
  const overcommit = detectOvercommitment(text);
  if (overcommit.length) {
    await addEvent(pool, leadId, { event_type: 'SALES_OVERCOMMIT', summary: '销售回复存在过度承诺', evidence: text.slice(0, 200), priority: 'high', recommended_action: 'review', payload: { risks: overcommit } });
  }
  const objectionKey = matchObjection(text);
  if (objectionKey) {
    const obj = getObjectionResponse(objectionKey);
    if (obj) {
      await addEvent(pool, leadId, { event_type: 'OBJECTION_DETECTED', summary: obj.label, evidence: text.slice(0, 200), priority: 'normal', recommended_action: 'use_standard_response', payload: obj });
    }
  }
  await pool.query(`UPDATE sales_leads SET last_human_at=NOW(), updated_at=NOW() WHERE id=$1`, [leadId]);
  return { ok: true, overcommit_risks: overcommit };
}

export { buildDiagnosisReport, detectOvercommitment, matchObjection, getObjectionResponse };
