import { SALES_STAGES } from './sales-collaboration.js';

export const STAGE_TRANSITIONS = Object.freeze({
  new: ['ai_greeting', 'nurture', 'unfit'],
  ai_greeting: ['need_identified', 'nurture', 'unfit'],
  need_identified: ['qualified', 'need_confirmed', 'nurture', 'unfit'],
  qualified: ['need_confirmed', 'sales_takeover', 'nurture', 'unfit'],
  need_confirmed: ['sales_takeover', 'demo_scheduled', 'nurture', 'unfit'],
  sales_takeover: ['need_confirmed', 'demo_scheduled', 'demo_completed', 'paused', 'lost'],
  demo_scheduled: ['demo_completed', 'paused', 'lost'],
  demo_completed: ['proposal', 'trial', 'paused', 'lost'],
  proposal: ['trial', 'won', 'paused', 'lost'],
  trial: ['won', 'paused', 'lost'],
  nurture: ['need_identified', 'qualified', 'sales_takeover', 'paused', 'lost'],
  paused: ['nurture', 'sales_takeover', 'lost'],
  unfit: ['nurture'],
  lost: ['nurture'],
  won: [],
});

export function canTransition(fromStage, toStage) {
  if (!SALES_STAGES.includes(toStage)) return false;
  if (!fromStage || fromStage === toStage) return true;
  return (STAGE_TRANSITIONS[fromStage] || []).includes(toStage);
}

export function buildLeadSummary(lead = {}, decision = {}) {
  const extracted = lead.extracted || {};
  return {
    customer: { name: lead.name || null, company: lead.company || null, city: lead.city || extracted.city || null, cuisine: lead.cuisine || extracted.cuisine || null },
    business: { store_count: lead.store_count ?? extracted.store_count ?? null, pos_brand: lead.pos_brand || extracted.pos_brand || null, phone_data_ready: lead.phone_data_ready ?? extracted.phone_data_ready ?? null, member_estimate: lead.member_estimate ?? extracted.member_estimate ?? null },
    pain_points: lead.pain_points?.length ? lead.pain_points : (extracted.pain_point ? [extracted.pain_point] : []),
    stage: lead.stage || 'new', intent_level: lead.handoff_level || lead.intent_level || 'low', intent_score: lead.intent_score || 0,
    missing_facts: decision.missing_facts || [], next_action: decision.next_action || lead.next_action || null,
    forbidden_customer_ai_topics: decision.customer_ai_policy?.forbidden || ['internal_score', 'discount', 'custom_commitment'],
  };
}

export function calculateSla(level = 'low', now = new Date()) {
  const minutes = level === 'critical' ? 5 : level === 'high' ? 10 : level === 'medium' ? 1440 : null;
  return minutes == null ? null : new Date(now.getTime() + minutes * 60000);
}
