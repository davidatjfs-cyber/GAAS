/**
 * AI 扮演客户：规则状态机生成下一句；可选 LLM 润色（失败则回退模板）。
 */

import { isStoreTrack, buildStoreCustomerReply, shouldEndStoreSession } from './store-tracks.js';
import { buildIncidentLockedReply } from './incident-dialogue.js';
import { buildCsDialogueReply, buildSalesDialogueReply } from './persona-dialogue.js';
export { buildIncidentLockedReply } from './incident-dialogue.js';

const SALES_REPLIES = {
  early_pitch: [
    '又开始讲功能了。我问你，你到底知不知道我门店现在最头疼什么？',
    '别念说明书。你们能解决什么具体问题？',
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
  no_soothe: ['你们就这态度？我是来解决问题的，不是听你推诿的。', '越说我越生气。'],
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
  traineeText = '', priorTraineeTexts = [], priorCustomerTexts = [], cumulativeStrengths = 0,
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
  const personaKey = persona?.persona_key || '';

  if (track === 'cs') {
    if (tags.has('no_soothe') || tags.has('hard_deny')) return pick(CS_REPLIES.no_soothe, salt);
    if (/rage|escalation/.test(personaKey) && (evalResult.violations || []).length) {
      return '我已经在录音了，你们继续这样我马上曝光。';
    }
    return buildCsDialogueReply({
      personaKey,
      evalResult,
      traineeText,
      priorTraineeTexts,
      priorCustomerTexts,
      cumulativeStrengths,
    });
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
  return buildSalesDialogueReply({
    evalResult,
    traineeText,
    priorTraineeTexts,
    priorCustomerTexts,
  });
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
