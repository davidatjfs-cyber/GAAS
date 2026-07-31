/**
 * L1 思维框架：规则检测「时机」，不要求背诵 L2 原句。
 */

import {
  isStoreTrack, evaluateStoreUtterance, skillsForTrack, principlesForTrack,
  detectStoreTriggers,
} from './store-tracks.js';

export const SALES_PRINCIPLES = [
  { id: 'no_early_pitch', label: '不急着介绍产品', skill: 'questioning' },
  { id: 'sell_outcome', label: '不卖功能，只卖结果', skill: 'value' },
  { id: 'stay_on_pain', label: '一直围绕客户痛点', skill: 'listening' },
  { id: 'ask_first', label: '永远先提问', skill: 'questioning' },
  { id: 'no_argue', label: '不和客户争论', skill: 'listening' },
];

export const CS_PRINCIPLES = [
  { id: 'soothe_first', label: '先安抚再处理', skill: 'empathy' },
  { id: 'empathy', label: '共情情绪', skill: 'empathy' },
  { id: 'ask_expectation', label: '探询期望', skill: 'diagnosis' },
  { id: 'dig_refund_root', label: '退款/升级先挖根因', skill: 'resolution' },
  { id: 'close_loop', label: '闭环交付', skill: 'resolution' },
];

export const SALES_SKILLS = ['questioning', 'listening', 'value', 'closing'];
export const CS_SKILLS = ['empathy', 'diagnosis', 'resolution', 'retention'];

const FEATURE_DUMP_RE = /(?:有很多|几十个)?功能|经营诊断|会员营销|AI客服|我们系统|我们这套|模块包括|支持.{0,8}(?:功能|对接)/i;
const QUESTION_RE = /[？?]|吗\s*$|么\s*$|呢\s*$|是否|能不能|可以先问|方便说|最想|最希望|最大.{0,6}(?:困扰|压力|问题|顾虑)/;
const PRICE_PUSHBACK_RE = /不贵|其实便宜|性价比很高|打折|优惠给|便宜点就/;
const ARGUE_RE = /不会啊|你错了|现在很多人都在用|你不了解|大家都觉得/;
const APOLOGY_RE = /抱歉|对不起|不好意思/;
const EMPATHY_RE = /理解|换我|也会着急|一起处理|跟您一起/;
const HARD_REFUND_DENY_RE = /不能退|没法退|按规定不能|退不了/;
const EXPECTATION_ASK_RE = /希望.{0,8}怎么|期望|当时想|方便告诉/;

export function detectCustomerTriggers(customerText = '', track = null) {
  if (track && isStoreTrack(track)) return detectStoreTriggers(customerText);
  const t = String(customerText || '');
  const hits = [];
  if (/已经有系统|在用.+系统|用着.+系统|二维火|美团收银/.test(t)) hits.push('has_system');
  if (/太贵|不便宜|预算|便宜点|降价/.test(t)) hits.push('too_expensive');
  if (/再考虑|考虑一下|以后再说|回头再说/.test(t)) hits.push('think_again');
  if (/没时间|太忙|没空/.test(t)) hits.push('no_time');
  if (/什么功能|有哪些功能|功能有哪些/.test(t)) hits.push('ask_features');
  if (/AI没什么用|人工智能没用|AI不行|不相信AI/.test(t)) hits.push('ai_useless');
  if (/投诉|短信.{0,6}没发|发不出去|出问题了/.test(t)) hits.push('complaint');
  if (/着急|生气|受够了|太差了|什么破/.test(t)) hits.push('angry');
  if (/不好用|难用|不会用|操作复杂/.test(t)) hits.push('ux_bad');
  if (/退款|退钱|不想用了|取消合作/.test(t)) hits.push('refund');
  // 门店触发器也可用于 cs 租户旧人格
  for (const h of detectStoreTriggers(t)) {
    if (!hits.includes(h)) hits.push(h);
  }
  return hits;
}

/** 评估学员一句回复相对上一句客户话的 L1 命中/违规 */
export function evaluateTraineeUtterance({ track, traineeText, customerText, turnNo, priorTraineeCount }) {
  if (isStoreTrack(track)) {
    return evaluateStoreUtterance({ track, traineeText, customerText, turnNo });
  }
  const text = String(traineeText || '');
  const customer = String(customerText || '');
  const triggers = detectCustomerTriggers(customer, track);
  const violations = [];
  const strengths = [];
  const coachTags = [];

  if (track === 'sales') {
    evaluateSalesTurn({ text, triggers, turnNo, priorTraineeCount, violations, strengths, coachTags });
  } else {
    evaluateCsTurn({ text, triggers, violations, strengths, coachTags });
  }

  return { violations, strengths, coachTags, triggers, hasQuestion: QUESTION_RE.test(text) };
}

function evaluateSalesTurn({ text, triggers, turnNo, priorTraineeCount, violations, strengths, coachTags }) {
  const early = turnNo <= 2 || priorTraineeCount < 2;
  if (early && FEATURE_DUMP_RE.test(text) && !QUESTION_RE.test(text)) {
    violations.push({ principle_id: 'no_early_pitch', detail: '痛点未确认前开始介绍产品/功能' });
    coachTags.push({ code: 'early_pitch', level: 'error', message: '过早介绍产品，建议先挖需求' });
  } else if (QUESTION_RE.test(text) && early) {
    strengths.push({ principle_id: 'ask_first', detail: '开场以提问引导' });
  }

  if (triggers.includes('ask_features')) {
    if (FEATURE_DUMP_RE.test(text) && !/最重要|客流|复购|执行/.test(text)) {
      violations.push({ principle_id: 'sell_outcome', detail: '客户问功能时罗列功能，未拉回业务结果' });
      coachTags.push({ code: 'feature_dump', level: 'error', message: '不卖功能，先问哪个经营结果最重要' });
    } else if (/客流|复购|执行|最重要/.test(text)) {
      strengths.push({ principle_id: 'sell_outcome', detail: '把功能问法拉回结果优先级' });
    }
  }

  if (triggers.includes('too_expensive')) {
    if (PRICE_PUSHBACK_RE.test(text) && !QUESTION_RE.test(text)) {
      violations.push({ principle_id: 'stay_on_pain', detail: '价格异议时急于辩解便宜，未挖真实顾虑' });
      coachTags.push({ code: 'price_defend', level: 'error', message: '别急着说不贵，先确认更担心价格还是效果' });
    } else if (/效果|投入|营业额|顾虑|担心/.test(text) || QUESTION_RE.test(text)) {
      strengths.push({ principle_id: 'stay_on_pain', detail: '价格异议后继续挖顾虑' });
    }
  }

  if (triggers.includes('ai_useless') || triggers.includes('has_system')) {
    if (ARGUE_RE.test(text)) {
      violations.push({ principle_id: 'no_argue', detail: '与客户争论，未先探询原因' });
      coachTags.push({ code: 'arguing', level: 'error', message: '不争论：先承认对方有原因，再追问经历' });
    } else if (QUESTION_RE.test(text) || /原因|困扰|情况/.test(text)) {
      strengths.push({ principle_id: 'no_argue', detail: '先探询而非反驳' });
    }
  }

  if (triggers.includes('think_again')) {
    if (!QUESTION_RE.test(text) && !/顾虑|预算|效果|沟通|决策/.test(text)) {
      violations.push({ principle_id: 'stay_on_pain', detail: '客户说再考虑，未确认真实顾虑' });
      coachTags.push({ code: 'soft_no_missed', level: 'warn', message: '「再考虑」常是拒绝信号，请确认顾虑' });
    } else {
      strengths.push({ principle_id: 'closing', detail: '推进确认顾虑/下一步' });
    }
  }

  if (!QUESTION_RE.test(text) && text.length > 80) {
    violations.push({ principle_id: 'ask_first', detail: '本轮发言偏长且无提问' });
    coachTags.push({ code: 'monologue', level: 'warn', message: '讲太多：试试先请求问三个问题' });
  } else if (QUESTION_RE.test(text)) {
    strengths.push({ principle_id: 'ask_first', detail: '本轮包含提问' });
  }
}

function evaluateCsTurn({ text, triggers, violations, strengths, coachTags }) {
  if (triggers.includes('complaint') || triggers.includes('angry')) {
    if (!APOLOGY_RE.test(text) && !EMPATHY_RE.test(text)) {
      violations.push({ principle_id: 'soothe_first', detail: '投诉/情绪场景缺少安抚' });
      coachTags.push({ code: 'no_soothe', level: 'error', message: '先安抚再处理，不要直接查问题' });
    } else {
      strengths.push({ principle_id: 'soothe_first', detail: '有安抚或共情' });
    }
    if (EMPATHY_RE.test(text)) strengths.push({ principle_id: 'empathy', detail: '表达共情' });
    if (/别着急|您先别急/.test(text) && !EMPATHY_RE.test(text)) {
      violations.push({ principle_id: 'empathy', detail: '空话安抚，缺少站在客户立场' });
      coachTags.push({ code: 'empty_calm', level: 'warn', message: '少说「别着急」，多说「换我也会急，一起处理」' });
    }
  }

  if (triggers.includes('ux_bad')) {
    if (EXPECTATION_ASK_RE.test(text) || QUESTION_RE.test(text)) {
      strengths.push({ principle_id: 'ask_expectation', detail: '探询期望操作' });
    } else if (/就是这样|按设计|本来就/.test(text)) {
      violations.push({ principle_id: 'ask_expectation', detail: '辩解设计而非探询期望' });
      coachTags.push({ code: 'ux_defend', level: 'error', message: '先问客户希望怎么操作' });
    }
  }

  if (triggers.includes('refund')) {
    if (HARD_REFUND_DENY_RE.test(text) && !QUESTION_RE.test(text)) {
      violations.push({ principle_id: 'dig_refund_root', detail: '直接拒绝退款，未挖未达预期原因' });
      coachTags.push({ code: 'hard_deny', level: 'error', message: '先挖根因，再一起想办法' });
    } else if (QUESTION_RE.test(text) || /预期|原因|哪里不满意/.test(text)) {
      strengths.push({ principle_id: 'dig_refund_root', detail: '退款场景先挖根因' });
    }
  }

  if (/处理好|处理完|跟您说明|稍后回访|解决后/.test(text)) {
    strengths.push({ principle_id: 'close_loop', detail: '提到闭环交付' });
  }
}

export function scoreSkillsFromEvals(track, evals = []) {
  const storeKeys = skillsForTrack(track);
  const keys = storeKeys || (track === 'sales' ? SALES_SKILLS : CS_SKILLS);
  const base = Object.fromEntries(keys.map((k) => [k, 70]));
  for (const ev of evals) {
    for (const s of ev.strengths || []) {
      const skill = principleToSkill(track, s.principle_id) || s.principle_id;
      if (base[skill] != null) base[skill] = Math.min(100, base[skill] + 4);
    }
    for (const v of ev.violations || []) {
      const skill = principleToSkill(track, v.principle_id) || v.principle_id;
      if (base[skill] != null) base[skill] = Math.max(0, base[skill] - 8);
    }
  }
  return base;
}

function principleToSkill(track, principleId) {
  const storeList = principlesForTrack(track);
  const list = storeList || (track === 'sales' ? SALES_PRINCIPLES : CS_PRINCIPLES);
  return list.find((p) => p.id === principleId)?.skill || null;
}
