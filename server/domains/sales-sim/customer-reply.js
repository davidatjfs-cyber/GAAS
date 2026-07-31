/**
 * AI 扮演客户：规则状态机生成下一句；可选 LLM 润色（失败则回退模板）。
 */

import { isStoreTrack, buildStoreCustomerReply, shouldEndStoreSession } from './store-tracks.js';
import { buildIncidentLockedReply } from './incident-dialogue.js';
export { buildIncidentLockedReply } from './incident-dialogue.js';

const SALES_REPLIES = {
  default: [
    '你继续说。',
    '然后呢？跟我现在有什么关系？',
    '我听着呢，重点是什么？',
  ],
  early_pitch: [
    '又开始讲功能了。我问你，你到底知不知道我门店现在最头疼什么？',
    '别念说明书。你们能解决什么具体问题？',
  ],
  too_expensive: [
    '一年两万对我来说不便宜。你们能保证回本吗？',
    '竞品更便宜，凭什么你们贵？',
  ],
  has_system: [
    '我们已经有系统了，再买一套不是重复浪费吗？',
    '数据都在旧系统里，你们怎么接？',
  ],
  think_again: [
    '我再考虑考虑吧，你们先别天天催。',
    '以后再说，这阵子没空决策。',
  ],
  no_time: [
    '真的没时间，你发资料我有空再看。',
    '（沉默了几秒）…你还有别的事吗？没有我先挂了。',
  ],
  ask_features: [
    '那你们到底有什么功能？别绕。',
    '功能列表发我看看，我自己判断。',
  ],
  ai_useless: [
    'AI有什么用？我们店里又不缺聊天机器人。',
    '上次被AI方案坑过，别跟我画饼。',
  ],
  good_question: [
    '这个问题问到点上了。我们现在最烦的是老客不回来。',
    '你既然问了…复购这块确实差，大概百分之十几。',
  ],
  hangup: [
    '行了，我先忙了，有需要再联系你们。',
  ],
  silence: [
    '……',
    '（客户沉默了十几秒）你继续？',
    '嗯。',
  ],
  interrupt: [
    '停一下——你别念了，直接说能解决什么。',
    '打断一下：价格到底多少？别绕。',
  ],
  last_minute: [
    '本来都要签了，财务刚把预算砍了，你们再给我一个不能拒绝的理由？',
    '我改主意了。除非你能说明白30天怎么看见数。',
  ],
  business: [
    '数字我都给你了，你第一步到底干什么？别再讲模块。',
    '复购上不去，你准备先动哪个杠杆？说具体动作。',
  ],
};

const CS_REPLIES = {
  default: ['那你打算怎么处理？', '你倒是给个准话。'],
  no_soothe: ['你们就这态度？我是来解决问题的，不是听你推诿的。', '越说我越生气。'],
  good_soothe: ['行，那你先查，我等你结果。', '好，你尽快，我这边会员还在问。'],
  refund: ['别绕弯子，能不能退就直说。', '预期完全没达到，我为什么要继续付？'],
  ux_bad: ['我就是找不到入口，你们设计给谁用的？', '有没有更简单的操作方式？'],
  resolved: ['如果真能处理好，我可以再观察两天。', '行，那你处理完务必跟我说一声。'],
};

function pick(arr, salt = 0) {
  if (!arr?.length) return '';
  return arr[Math.abs(salt) % arr.length];
}

export function applyStateDelta(session, { evalResult, track }) {
  const next = {
    emotion: Number(session.emotion ?? 50),
    trust: Number(session.trust ?? 40),
    close_readiness: Number(session.close_readiness ?? 15),
    satisfaction: Number(session.satisfaction ?? 60),
  };
  const vCount = evalResult.violations?.length || 0;
  const sCount = evalResult.strengths?.length || 0;
  if (track === 'sales') {
    next.trust += sCount * 3 - vCount * 6;
    next.emotion += sCount * 2 - vCount * 5;
    next.close_readiness += sCount * 4 - vCount * 5;
    if (evalResult.hasQuestion) next.close_readiness += 2;
  } else {
    // cs + 门店轨：满意度/情绪主轴
    next.satisfaction += sCount * 5 - vCount * 8;
    next.emotion += sCount * 3 - vCount * 7;
    next.trust += sCount * 2 - vCount * 4;
  }
  for (const k of Object.keys(next)) {
    next[k] = Math.max(0, Math.min(100, Math.round(next[k])));
  }
  return next;
}

export function shouldEndSession(session, track) {
  if (isStoreTrack(track)) return shouldEndStoreSession(session, track);
  if (track === 'sales' && session.emotion <= 15 && session.trust <= 20) {
    return { end: true, outcome: 'hangup', reason: '客户情绪与信任过低，准备结束沟通' };
  }
  if (track === 'cs' && session.satisfaction <= 20) {
    return { end: true, outcome: 'failed', reason: '客户满意度过低，会话失败' };
  }
  return { end: false };
}

export function buildCustomerReply({
  track, persona, evalResult, session, turnNo,
  traineeText = '', priorTraineeTexts = [], priorCustomerTexts = [],
}) {
  const incident = session?.incident_snapshot || session?.meta?.incident || null;
  if (incident?.locked_facts || incident?.card_key) {
    return buildIncidentLockedReply({
      incident, evalResult, turnNo, traineeText, priorTraineeTexts, priorCustomerTexts,
    });
  }
  if (isStoreTrack(track)) {
    return buildStoreCustomerReply({ track, evalResult, turnNo });
  }
  const tags = new Set((evalResult.coachTags || []).map((t) => t.code));
  const triggers = evalResult.triggers || [];
  const salt = turnNo + Number(session.close_readiness || 0);

  if (track === 'cs') {
    if (tags.has('no_soothe') || tags.has('hard_deny')) return pick(CS_REPLIES.no_soothe, salt);
    if (triggers.includes('refund') || /refund|lawyer/.test(persona?.persona_key || '')) {
      return pick(CS_REPLIES.refund, salt);
    }
    if (triggers.includes('ux_bad')) return pick(CS_REPLIES.ux_bad, salt);
    if (/rage|escalation/.test(persona?.persona_key || '') && (evalResult.violations || []).length) {
      return '我已经在录音了，你们继续这样我马上曝光。';
    }
    if ((evalResult.strengths || []).length >= 2) return pick(CS_REPLIES.good_soothe, salt);
    if (session.satisfaction >= 75) return pick(CS_REPLIES.resolved, salt);
    return pick(CS_REPLIES.default, salt);
  }

  const traits = persona?.profile?.traits || [];
  const diff = Number(persona?.difficulty || 1);

  if (session.emotion <= 18) return pick(SALES_REPLIES.hangup, salt);
  if (traits.includes('临门反悔') || /last_minute/.test(persona?.persona_key || '')) {
    if (turnNo >= 2) return pick(SALES_REPLIES.last_minute, salt);
  }
  if (traits.includes('经营真题') || persona?.source_type === 'business') {
    if (tags.has('early_pitch') || tags.has('feature_dump') || triggers.includes('ask_features')) {
      return pick(SALES_REPLIES.business, salt);
    }
  }
  if (tags.has('early_pitch') || tags.has('feature_dump')) return pick(SALES_REPLIES.early_pitch, salt);
  if (traits.includes('沉默') && turnNo % 2 === 0) return pick(SALES_REPLIES.silence, salt);
  if (diff >= 7 && turnNo >= 2 && salt % 3 === 0) return pick(SALES_REPLIES.interrupt, salt);
  if ((evalResult.strengths || []).some((s) => s.principle_id === 'ask_first' || s.principle_id === 'no_argue')) {
    if (turnNo >= 2) return pick(SALES_REPLIES.good_question, salt);
  }
  for (const key of ['too_expensive', 'has_system', 'think_again', 'no_time', 'ask_features', 'ai_useless']) {
    if (triggers.includes(key)) return pick(SALES_REPLIES[key], salt);
  }
  if (traits.includes('极忙') && turnNo >= 4) return pick(SALES_REPLIES.no_time, salt);
  return pick(SALES_REPLIES.default, salt);
}

/** 可选：用 LLM 让客户语气更贴人格；失败则返回 ruleReply */
export async function maybePolishCustomerReply(callLLM, {
  persona, ruleReply, history, lockedFacts = [], priorCustomerTexts = [],
}) {
  if (typeof callLLM !== 'function' || !ruleReply) return ruleReply;
  try {
    const profile = persona?.profile || {};
    const factsLine = Array.isArray(lockedFacts) && lockedFacts.length
      ? `本事故已锁定事实（禁止另起新问题）：${lockedFacts.join('；')}`
      : '';
    const ban = priorCustomerTexts.slice(-4).filter(Boolean).join(' / ');
    const prompt = [
      '你在岗位陪练中扮演对话对方，只输出一句原话，不要解释。',
      `角色场景：${persona?.title || ''} ${JSON.stringify(profile)}`,
      factsLine,
      ban ? `禁止与下列已问过的话意思重复（必须换新角度）：${ban}` : '',
      `最近对话：\n${history.slice(-6).map((h) => `${h.role}: ${h.content}`).join('\n')}`,
      `本轮必须表达的核心意思（可改写语气，勿增加新事实/新投诉点）：${ruleReply}`,
      '要求：口语自然；紧扣已锁定事实；推进下一问；不超过80字；禁止「我再确认一下」套话复读。',
    ].filter(Boolean).join('\n');
    // callLLM(messages, options) — 勿传对象作第一参
    const r = await callLLM(
      [{ role: 'user', content: prompt }],
      {
        purpose: 'talent_engine_customer_polish',
        temperature: 0.7,
        max_tokens: 120,
        skipCache: true,
        trackTier: true,
      }
    );
    const text = String(r?.content || r?.text || '').trim().replace(/^["「]|["」]$/g, '');
    if (r?.ok !== false && text && text.length < 120) return text;
  } catch (_) {
    /* fall back */
  }
  return ruleReply;
}
