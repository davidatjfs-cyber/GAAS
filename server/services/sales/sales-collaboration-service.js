import { SALES_STAGES } from './sales-collaboration.js';

// 这份表此前只在"手动/stage路由"这一个入口生效，真正的业务动作(createDemo/createMeeting/
// createTrial/createDeal/recordLossReason/暂停)长期是绕过它、无条件直接写stage的——本轮把
// 这6处收口到统一的 transitionLeadStage 并真正执行校验前，先把这份表补齐到"和这6处原有行为
// 一致"，而不是凭空设计一套更严格的新规则(那样会在没人注意的情况下拒绝掉真实成交/记录动作，
// 比如demo没走完整proposal流程就直接成交这种真实会发生的情况)。
//
// createDeal/createTrial 在旧代码里是完全无条件的UPDATE(不看当前stage)，所以'won'/'trial'
// 必须能从任意非终态直接抵达，不能只挂在部分中间状态上——用代码而不是手抄一遍每个分支，
// 避免漏挂导致真实成交在收口后突然被拒绝。
const BASE_TRANSITIONS = {
  new: ['ai_greeting', 'profiling', 'nurture', 'unfit', 'sales_takeover', 'demo_requested', 'demo_completed', 'paused', 'lost'],
  ai_greeting: ['need_identified', 'nurture', 'unfit', 'sales_takeover', 'demo_completed', 'paused', 'lost'],
  need_identified: ['qualified', 'profiling', 'need_confirmed', 'nurture', 'unfit', 'sales_takeover', 'demo_requested', 'demo_completed', 'paused', 'lost'],
  profiling: ['diagnosed', 'qualified', 'need_confirmed', 'nurture', 'unfit', 'sales_takeover', 'demo_requested', 'paused', 'lost'],
  diagnosed: ['qualified', 'handoff_pending', 'demo_requested', 'nurture', 'paused', 'lost'],
  qualified: ['need_confirmed', 'handoff_pending', 'sales_takeover', 'demo_requested', 'nurture', 'unfit', 'demo_completed', 'paused', 'lost'],
  need_confirmed: ['sales_takeover', 'demo_scheduled', 'nurture', 'unfit', 'paused', 'lost'],
  handoff_pending: ['human_following', 'demo_requested', 'sales_takeover', 'paused', 'lost'],
  human_following: ['demo_requested', 'demo_scheduled', 'demo_completed', 'paused', 'lost'],
  sales_takeover: ['need_confirmed', 'demo_requested', 'demo_scheduled', 'demo_completed', 'paused', 'lost'],
  demo_requested: ['demo_scheduled', 'demo_rescheduled', 'demo_cancelled', 'paused', 'lost'],
  demo_scheduled: ['demo_rescheduled', 'demo_cancelled', 'demo_no_show', 'demo_completed', 'paused', 'lost'],
  demo_completed: ['proposal', 'paused', 'lost'],
  proposal: ['paused', 'lost'],
  trial: ['paused', 'lost'],
  nurture: ['need_identified', 'qualified', 'sales_takeover', 'paused', 'lost'],
  paused: ['nurture', 'sales_takeover', 'lost'],
  unfit: ['nurture'],
  lost: ['nurture'],
  won: [],
};
// 'won'/'trial'本身不能再转出到别的"结果类"状态；'lost'/'unfit'是"已放弃"状态，
// 不能不经过nurture重新激活就直接跳成交——这两个不是旧代码曾经允许过的高频真实路径，
// 是"收口现有行为"和"不能让明显不合理的跳转蒙混过关"之间的取舍，选择后者。
const RESULT_STATES_REACHABLE_FROM_ANYWHERE = ['trial', 'won'];
const TERMINAL_OR_RESULT_SOURCES = new Set(['won', 'lost', 'unfit']);

export const STAGE_TRANSITIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(BASE_TRANSITIONS).map(([from, targets]) => [
      from,
      TERMINAL_OR_RESULT_SOURCES.has(from) ? targets : Array.from(new Set([...targets, ...RESULT_STATES_REACHABLE_FROM_ANYWHERE])),
    ])
  )
);

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
