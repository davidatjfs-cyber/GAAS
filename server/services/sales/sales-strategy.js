/**
 * 销售对话策略机：确定性决定「下一问 / 是否转人工 / 能否报价」
 * LLM 只负责「怎么说」，不负责「该不该说」。
 */
import { DIAGNOSTIC_SLOTS, knowledgeForPain, containsForbiddenClaim } from './sales-knowledge.js';

const HIGH_INTENT_PATTERNS = [
  /价格|多少钱|报价|费用|收费/,
  /demo|演示|看一下系统|演示一下/i,
  /合同|签约|付款|对公/,
  /试跑|试用|试点/,
  /接入|对接|能不能接/,
  /什么时候能上|上线时间|下周|尽快/,
];

const BUYING_SIGNALS = [/正在找|想上系统|准备采购|对比过|有预算/];

export function extractSlotsFromText(text = '', prev = {}) {
  const t = String(text || '');
  const out = { ...prev };

  const storeM = t.match(/(\d+)\s*家/);
  if (storeM) out.store_count = Number(storeM[1]);

  if (/客如云|美团|企迈|天财|二维火|收钱吧|哗啦啦|博云/.test(t)) {
    const m = t.match(/客如云|美团|企迈|天财|二维火|收钱吧|哗啦啦|博云/);
    if (m) out.pos_brand = m[0];
  }

  if (/有手机号|能记录手机|有会员手机|手机号齐全|可以.*手机号/.test(t)) out.phone_data_ready = true;
  if (/没有手机号|无手机号|记录不了手机/.test(t)) out.phone_data_ready = false;

  if (/复购|老客|流失|回店/.test(t)) out.pain_point = '复购';
  else if (/执行|店长|不会干|跟进/.test(t)) out.pain_point = '门店执行';
  else if (/培训|人才|员工|培养/.test(t)) out.pain_point = '人才培养';

  if (/老板|我自己|法人/.test(t)) out.decision_role = '老板';
  else if (/运营|店长|经理/.test(t)) out.decision_role = '运营';
  else if (/IT|技术|信息/.test(t)) out.decision_role = 'IT';

  const cityM = t.match(/(北京|上海|广州|深圳|杭州|成都|重庆|武汉|南京|苏州|西安|天津|青岛|厦门|长沙|郑州)[^市]?/);
  if (cityM) out.city = cityM[1];

  if (/潮汕|粤菜|川菜|火锅|烧烤|湘菜|日料|西餐|快餐|咖啡|茶饮|烘焙/.test(t)) {
    const m = t.match(/潮汕|粤菜|川菜|火锅|烧烤|湘菜|日料|西餐|快餐|咖啡|茶饮|烘焙/);
    if (m) out.cuisine = m[0];
  }

  const memM = t.match(/(\d+(?:\.\d+)?)\s*万/);
  if (memM && /会员|客户|手机/.test(t)) out.member_estimate = Math.round(Number(memM[1]) * 10000);

  if (/在用.*(会员|营销|CRM|系统|软件)|已经有.*(会员|营销|系统|软件)|用过.*(系统|软件)/i.test(t)) out.other_system_used = true;
  else if (/没有用.*系统|没有其他系统|没用系统|没有系统|没用过.*(系统|软件)/.test(t)) out.other_system_used = false;

  return out;
}

export function detectEvents(text = '') {
  const t = String(text || '');
  const events = [];
  if (/价格|多少钱|报价|费用/.test(t)) events.push({ event_type: 'ASK_PRICE', priority: 'high', recommended_action: 'takeover' });
  if (/demo|演示/i.test(t)) events.push({ event_type: 'REQUEST_DEMO', priority: 'high', recommended_action: 'takeover' });
  if (/试跑|试用/.test(t)) events.push({ event_type: 'REQUEST_TRIAL', priority: 'high', recommended_action: 'takeover' });
  if (/合同|签约/.test(t)) events.push({ event_type: 'ASK_CONTRACT', priority: 'high', recommended_action: 'takeover' });
  if (/接入|对接|POS/.test(t) && /能|吗|怎么/.test(t)) events.push({ event_type: 'ASK_POS_INTEGRATION', priority: 'high', recommended_action: 'notify_sales' });
  if (BUYING_SIGNALS.some((re) => re.test(t))) events.push({ event_type: 'BUYING_INTENT', priority: 'medium', recommended_action: 'notify_sales' });
  if (/复购|老客|执行|培训|流失/.test(t)) events.push({ event_type: 'PAIN_STATED', priority: 'normal', recommended_action: 'continue' });
  return events;
}

export function nextDiagnosticQuestion(extracted = {}) {
  for (const slot of DIAGNOSTIC_SLOTS) {
    if (slot.key === 'pain_point' && !extracted.pain_point) return slot;
    if (slot.key === 'phone_data_ready' && extracted.phone_data_ready == null) return slot;
    if (slot.key === 'store_count' && extracted.store_count == null) return slot;
    if (slot.key === 'pos_brand' && !extracted.pos_brand) return slot;
    if (slot.key === 'decision_role' && !extracted.decision_role) return slot;
    if (slot.key === 'city' && !extracted.city) return slot;
    if (slot.key === 'cuisine' && !extracted.cuisine) return slot;
    if (slot.key === 'member_estimate' && extracted.member_estimate == null) return slot;
    if (slot.key === 'other_system_used' && extracted.other_system_used == null) return slot;
  }
  return null;
}

export function shouldTakeover({ text, extracted, intentScore, controller }) {
  if (controller === 'human' || controller === 'waiting_human') return { takeover: false, reason: 'already_human' };
  const t = String(text || '');
  if (HIGH_INTENT_PATTERNS.some((re) => re.test(t))) return { takeover: true, reason: 'high_intent_phrase', level: 'high' };
  if ((intentScore || 0) >= 70) return { takeover: true, reason: 'score_threshold', level: 'high' };
  if ((extracted.store_count || 0) >= 3 && extracted.pain_point && extracted.phone_data_ready === true && (intentScore || 0) >= 50) {
    return { takeover: true, reason: 'qualified_profile', level: 'high' };
  }
  if ((intentScore || 0) >= 40) return { takeover: false, reason: 'watch', level: 'medium' };
  return { takeover: false, reason: 'continue', level: 'low' };
}

export function buildStrategyPlan({ userText, extracted, history = [], intentScore = 0, controller = 'ai' }) {
  const slots = extractSlotsFromText(userText, extracted || {});
  const events = detectEvents(userText);
  const nextQ = nextDiagnosticQuestion(slots);
  const takeover = shouldTakeover({ text: userText, extracted: slots, intentScore, controller });
  const knowledge = knowledgeForPain(slots.pain_point || userText);

  let mode = 'diagnose';
  if (takeover.takeover) mode = 'handoff';
  else if (/你们|系统|功能|什么|怎么|能否|可以/.test(String(userText || '')) && slots.pain_point) mode = 'value_match';
  else if (/你们|系统|功能|什么/.test(String(userText || ''))) mode = 'introduce';

  return {
    mode,
    extracted: slots,
    events,
    next_question: nextQ,
    knowledge,
    takeover,
    allow_price_talk: !takeover.takeover && !/折扣|便宜点|优惠/.test(String(userText || '')),
    history_turns: history.length,
  };
}

export function sanitizeReply(text = '') {
  let out = String(text || '').trim();
  const hit = containsForbiddenClaim(out);
  if (hit) {
    out = out.replace(hit, '需由顾问评估后确认');
  }
  // 压缩过长输出
  if (out.length > 220) out = `${out.slice(0, 200)}…`;
  // 确保最多一个问号句（粗略）
  const parts = out.split('？');
  if (parts.length > 2) out = `${parts[0]}？`;
  return out.trim();
}

/** 无 LLM 时的高质量模板回复（保证像顾问） */
export function templateReply(plan, userText) {
  const e = plan.extracted || {};
  const q = plan.next_question?.question;

  if (plan.mode === 'handoff') {
    return '根据您提到的情况，已经比较适合安排顾问做一次针对性说明和可行性判断。我这边先为您转人工顾问，他会基于您的门店数和数据条件继续沟通，不耽误您时间。';
  }

  if (plan.mode === 'introduce') {
    const base = plan.knowledge?.body || '';
    return `${base}${q ? ` ${q}` : ' 您目前最想先解决哪一类问题？'}`;
  }

  if (plan.mode === 'value_match') {
    const pain = e.pain_point || '经营问题';
    return `您说的「${pain}」正是我们重点场景。${plan.knowledge?.body || ''}${q ? ` ${q}` : ''}`;
  }

  // diagnose
  if (e.store_count && !e.pain_point) {
    return `收到，${e.store_count} 家门店的规模已经适合看连锁经营闭环。${q || '您现在最头疼的是复购、执行还是人才培养？'}`;
  }
  if (userText && q) {
    return `明白。${q}`;
  }
  return q || '您好，我是餐厅AI增长顾问。请问您目前有几家门店？';
}
