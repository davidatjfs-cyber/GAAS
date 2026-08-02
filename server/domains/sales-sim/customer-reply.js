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
  persona, ruleReply, history, lockedFacts = [], priorCustomerTexts = [], state = null,
}) {
  if (typeof callLLM !== 'function' || !ruleReply) return ruleReply;
  try {
    const profile = persona?.profile || {};
    const factsLine = Array.isArray(lockedFacts) && lockedFacts.length
      ? `本事故已锁定事实（禁止另起新问题）：${lockedFacts.join('；')}`
      : '';
    const ban = priorCustomerTexts.slice(-4).filter(Boolean).join(' / ');
    const stateLine = state && Number.isFinite(Number(state.emotion))
      ? `当前你的情绪${Number(state.emotion)}/100、信任${Number(state.trust)}/100、满意度${Number(state.satisfaction)}/100——你的语气和内容必须匹配这个情绪强度。`
      : '';
    const dialogue = (history || [])
      .filter((h) => h.role === 'customer' || h.role === 'trainee')
      .slice(-6)
      .map((h) => `${h.role === 'customer' ? '客户' : '学员'}: ${h.content}`)
      .join('\n');
    const prompt = [
      `你正在扮演「${persona?.title || '对话对方'}」本人，是顾客/客户，不是客服。只输出一句你的原话，不要解释。`,
      `角色场景：${persona?.title || ''} ${JSON.stringify(profile)}`,
      factsLine,
      ban ? `禁止与下列已问过的话意思重复（必须换新角度）：${ban}` : '',
      `最近对话：\n${dialogue}`,
      `本轮必须表达的核心意思（保留情绪强度，可换更口语的说法；不得改变说话人、不得新增事实/投诉点）：${ruleReply}`,
      stateLine,
      '要求：你始终是顾客本人，绝不能说服务方才会说的话（如「我帮您跟进」「马上告诉您」「您看还有什么需要帮忙」「我们会尽快处理」）；如果学员上一句承认了你的感受或给了承诺，先顺着承认一句再推进；口语自然；推进下一问；不超过80字；禁止「我再确认一下」套话复读。',
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
    // 服务方口吻（视角反转）→ 回退规则句，避免客户替客服承诺
    const serviceVoice = /帮您跟进|为您跟进|马上告诉您|随时为您|您看(还|是否)?有.{0,8}需要|还需要我|我会尽快(处理|跟进|通知)|帮您处理|为您处理|我们(会|将).{0,6}(服务|跟进)|为您服务/.test(text);
    if (r?.ok !== false && text && text.length < 120 && !serviceVoice) return text;
  } catch (_) {
    /* fall back */
  }
  return ruleReply;
}
