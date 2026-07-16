/**
 * 客户 AI ↔ 销售 AI 协作协议。
 * 客户 AI 只负责客户可见表达与事实采集；销售 AI 负责内部判断和指导。
 */
export const SALES_STAGES = Object.freeze([
  'new', 'ai_greeting', 'need_identified', 'qualified', 'sales_takeover',
  'need_confirmed', 'profiling', 'diagnosed', 'handoff_pending', 'human_following',
  'demo_requested', 'demo_scheduled', 'demo_rescheduled', 'demo_cancelled', 'demo_no_show', 'demo_completed', 'proposal', 'trial', 'won',
  'onboarding', 'active', 'renewal_due', 'renewed', 'nurture', 'paused', 'unfit', 'lost', 'disqualified', 'churned',
]);

export const CUSTOMER_AI_POLICIES = Object.freeze({
  ai: { allowed: ['public_knowledge', 'diagnostic_question', 'standard_case'], forbidden: ['internal_score', 'discount', 'custom_commitment'] },
  waiting_human: { allowed: ['handoff_acknowledgement', 'collect_customer_message'], forbidden: ['price_detail', 'pos_commitment', 'implementation_commitment'] },
  human: { allowed: [], forbidden: ['automatic_reply'] },
});

export function normalizeCustomerAiEvent(event = {}, fallbackEvidence = '') {
  return {
    event_type: String(event.event_type || 'CUSTOMER_MESSAGE').slice(0, 80),
    summary: String(event.summary || '').slice(0, 500),
    evidence: String(event.evidence || fallbackEvidence || '').slice(0, 500),
    confidence: Math.max(0, Math.min(1, Number(event.confidence ?? 0.8) || 0)),
    recommended_action: String(event.recommended_action || 'continue').slice(0, 120),
    priority: ['low', 'normal', 'medium', 'high', 'critical'].includes(event.priority) ? event.priority : 'normal',
    payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
  };
}

export function buildSalesDecision({ lead = {}, score = {}, events = [], guidance = null } = {}) {
  const eventTypes = new Set((events || []).map((e) => e.event_type));
  const highSignals = ['ASK_PRICE', 'REQUEST_DEMO', 'REQUEST_TRIAL', 'ASK_CONTRACT', 'ASK_POS_INTEGRATION', 'ASK_DISCOUNT', 'BUYING_INTENT'];
  const critical = eventTypes.has('ASK_CONTRACT') || eventTypes.has('ASK_DISCOUNT') ||
    (eventTypes.has('REQUEST_TRIAL') && eventTypes.has('ASK_POS_INTEGRATION')) ||
    (lead.decision_role === '老板' && Number(score.intent_score || 0) >= 80);
  const high = critical || eventTypes.has('REQUEST_DEMO') || highSignals.some((x) => eventTypes.has(x)) || Number(score.intent_score || 0) >= 70;
  const level = critical ? 'critical' : high ? 'high' : Number(score.intent_score || 0) >= 40 ? 'medium' : 'low';
  const missing = [];
  const e = lead.extracted || {};
  if (e.store_count == null) missing.push('store_count');
  if (!e.pos_brand) missing.push('pos_brand');
  if (e.phone_data_ready == null) missing.push('phone_data_ready');
  if (!e.decision_role) missing.push('decision_role');
  const recommended = high ? 'handoff_now' : level === 'medium' ? 'notify_and_continue' : 'continue_ai';
  const stage = high ? (lead.stage === 'ai_greeting' || lead.stage === 'need_identified' ? 'qualified' : lead.stage) :
    (lead.stage === 'new' || lead.stage === 'ai_greeting' ? 'need_identified' : lead.stage);
  return {
    intent_level: level,
    intent_score: Number(score.intent_score || 0),
    sales_stage: stage,
    controller_recommendation: recommended,
    missing_facts: missing,
    recommended_module: e.pain_point || null,
    next_action: high ? (critical ? '负责人立即介入并确认报价/合同边界' : '10分钟内人工接管并预约Demo') : missing.length ? `优先补齐：${missing[0]}` : '继续客户AI诊断',
    customer_ai_policy: CUSTOMER_AI_POLICIES[recommended === 'handoff_now' ? 'waiting_human' : 'ai'],
    guidance: guidance || { mode: 'ask_next_missing_fact', slot: missing[0] || null, expires_in_turns: 1 },
    evidence: (events || []).filter((e) => e.priority === 'high' || e.priority === 'critical').slice(0, 8),
  };
}

export function buildCustomerAiGuidance(decision = {}) {
  if (decision.controller_recommendation === 'handoff_now') {
    return { mode: 'waiting_human', question: null, allowed_topics: ['handoff'], forbidden_topics: ['price_detail', 'pos_commitment', 'implementation_commitment'], expires_in_turns: 2 };
  }
  const slot = decision.missing_facts?.[0] || null;
  return { mode: 'diagnose', question_slot: slot, allowed_topics: ['public_knowledge', 'diagnosis'], forbidden_topics: ['internal_score', 'discount', 'custom_commitment'], expires_in_turns: 1 };
}
