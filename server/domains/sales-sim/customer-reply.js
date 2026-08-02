/**
 * AI 扮演客户：
 * - 规则状态机决定「意图 + 引导 + 兜底句」（buildCustomerTurn）；
 * - 人格路径用 LLM 按意图+状态+学员上一句生成整句（maybeGenerateCustomerReply）；
 * - 事故卡/门店轨仍走专用规则路径 + 可选润色（maybePolishCustomerReply）。
 */

import { isStoreTrack, buildStoreCustomerReply, shouldEndStoreSession } from './store-tracks.js';
import { buildIncidentLockedReply } from './incident-dialogue.js';
import { buildCsDialogueTurn, buildSalesDialogueTurn } from './persona-dialogue.js';
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

/** 服务方口吻（视角反转）标记：客户绝不能说的话 */
const CUSTOMER_SERVICE_VOICE_RE = /帮您跟进|为您跟进|马上告诉您|随时为您|您看(还|是否)?有.{0,8}需要|还需要我|我会尽快(处理|跟进|通知)|帮您处理|为您处理|我们(会|将).{0,6}(服务|跟进)|为您服务/;

export function similarLine(a, b) {
  const norm = (s) => String(s || '').replace(/[「」""'：:，,。！？?\s]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y.slice(0, 12)) || y.includes(x.slice(0, 12))) return true;
  return false;
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

/** 满意收束：客户诉求已全部覆盖且满意度/成交信号达标 → 自然道谢收场（第二次 resolve 时触发） */
export function shouldResolveSession({
  track, session, turnPlan, priorCustomerIntents = [], turnNo = 1,
}) {
  if (turnNo < 2 || !turnPlan) return { end: false };
  const intent = turnPlan.intent || '';
  const priorResolves = priorCustomerIntents.filter((i) => i === 'resolve' || i === 'signal').length;
  if (track === 'cs' && intent === 'resolve' && priorResolves >= 1) {
    if (Number(session.satisfaction) >= 65) {
      return { end: true, outcome: 'resolved', closingLine: '好，那就按你说的办，处理完了告诉我一声，辛苦了。' };
    }
    if (Number(session.satisfaction) >= 55) {
      return { end: true, outcome: 'completed', closingLine: '行，那就先这样，处理完了跟我说一声。' };
    }
  }
  if (track === 'sales' && intent === 'signal' && priorResolves >= 1) {
    if (Number(session.close_readiness) >= 65) {
      return { end: true, outcome: 'won', closingLine: '行，那就先按这个方案来，你出个具体计划我看看。' };
    }
    if (Number(session.close_readiness) >= 50) {
      return { end: true, outcome: 'completed', closingLine: '行，方案先发我看看，回头再说。' };
    }
  }
  return { end: false };
}

function plan(reply, intent, guidance = '') {
  return { reply, intent, guidance };
}

export function buildCustomerTurn({
  track, persona, evalResult, session, turnNo,
  traineeText = '', priorTraineeTexts = [], priorCustomerTexts = [], cumulativeStrengths = 0,
}) {
  const incident = session?.incident_snapshot || session?.meta?.incident || null;
  if (incident?.locked_facts || incident?.card_key) {
    return plan(
      buildIncidentLockedReply({
        incident, evalResult, turnNo, traineeText, priorTraineeTexts, priorCustomerTexts,
      }),
      'incident_probe',
      '按事故卡追问队列推进，只围绕锁定事实。'
    );
  }
  if (isStoreTrack(track)) {
    return plan(buildStoreCustomerReply({ track, evalResult, turnNo }), 'store', '');
  }
  const tags = new Set((evalResult.coachTags || []).map((t) => t.code));
  const triggers = evalResult.triggers || [];
  const salt = turnNo + Number(session.close_readiness || 0);
  const personaKey = persona?.persona_key || '';

  if (track === 'cs') {
    if (tags.has('no_soothe') || tags.has('hard_deny')) {
      return plan(pick(CS_REPLIES.no_soothe, salt), 'no_soothe', '学员没有先安抚你的情绪，你表达不满，语气符合当前状态。');
    }
    if (/rage|escalation/.test(personaKey) && (evalResult.violations || []).length) {
      return plan('我已经在录音了，你们继续这样我马上曝光。', 'rage_escalation', '你已经愤怒到要投诉曝光，语气强硬。');
    }
    return buildCsDialogueTurn({
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

  if (session.emotion <= 18) {
    return plan(pick(SALES_REPLIES.hangup, salt), 'hangup', '你的情绪与信任已经很低，准备结束这次沟通。');
  }
  if (traits.includes('临门反悔') || /last_minute/.test(persona?.persona_key || '')) {
    if (turnNo >= 2) {
      return plan(pick(SALES_REPLIES.last_minute, salt), 'last_minute', '你在最后一刻反悔，要求一个无法拒绝的理由。');
    }
  }
  if (traits.includes('经营真题') || persona?.source_type === 'business') {
    if (tags.has('early_pitch') || tags.has('feature_dump') || triggers.includes('ask_features')) {
      return plan(pick(SALES_REPLIES.business, salt), 'business_press', '学员又在讲模块/功能，你要的是第一步具体动作和数字。');
    }
  }
  if (tags.has('early_pitch') || tags.has('feature_dump')) {
    return plan(pick(SALES_REPLIES.early_pitch, salt), 'early_pitch', '学员过早介绍功能，你反感，要求他先说清你的痛点。');
  }
  if (traits.includes('沉默') && turnNo % 2 === 0) {
    return plan(pick(SALES_REPLIES.silence, salt), 'silence', '你是沉默型客户，回应极短或不说话。');
  }
  if (diff >= 7 && turnNo >= 2 && salt % 3 === 0) {
    return plan(pick(SALES_REPLIES.interrupt, salt), 'interrupt', '你打断学员，要求直接讲重点。');
  }
  return buildSalesDialogueTurn({
    evalResult,
    traineeText,
    priorTraineeTexts,
    priorCustomerTexts,
  });
}

export function buildCustomerReply(...args) {
  return buildCustomerTurn(...args).reply;
}

function extractJsonReply(raw) {
  let s = String(raw || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function isValidGeneratedReply(text, lastCustomer) {
  if (!text || text.trim().length < 2 || text.length > 120) return false;
  if (!/[\u4e00-\u9fff]/.test(text)) return false;
  if (CUSTOMER_SERVICE_VOICE_RE.test(text)) return false;
  if (lastCustomer && similarLine(lastCustomer, text)) return false;
  return true;
}

/**
 * 中期方案：LLM 作为「对话推进器」——规则层给出意图+引导，LLM 生成整句。
 * 要求接住学员上一句实质内容；输出 JSON { intent, reply }；不满足校验回退规则句。
 */
export async function maybeGenerateCustomerReply(callLLM, {
  persona, track = 'cs', state = null, ruleReply, intent = '', guidance = '',
  history = [], lockedFacts = [], priorCustomerTexts = [], priorCustomerIntents = [],
}) {
  if (typeof callLLM !== 'function' || !ruleReply) return { reply: ruleReply, intent };
  try {
    const profile = persona?.profile || {};
    const roleLine = track === 'sales' ? '顾客（老板/决策人）' : '顾客/客户';
    const factsLine = Array.isArray(lockedFacts) && lockedFacts.length
      ? `锁定事实（不得编造/新增）：${lockedFacts.join('；')}`
      : '';
    const stateLine = state && Number.isFinite(Number(state.emotion))
      ? `当前你的情绪${Number(state.emotion)}/100、信任${Number(state.trust)}/100、满意度${Number(state.satisfaction)}/100——语气必须匹配这个状态。`
      : '';
    const dialogue = (history || [])
      .filter((h) => h.role === 'customer' || h.role === 'trainee')
      .slice(-8)
      .map((h) => `${h.role === 'customer' ? '客户' : '学员'}: ${h.content}`)
      .join('\n');
    const intentLine = (priorCustomerIntents || []).slice(-5).filter(Boolean).length
      ? `你已问过/表达过的意图：${priorCustomerIntents.slice(-5).filter(Boolean).join('、')}（不要重复）`
      : '';
    const prompt = [
      `你正在扮演「${persona?.title || '对话对方'}」本人，一位真实的${roleLine}，不是客服、不是教练。`,
      `角色卡：${JSON.stringify(profile)}`,
      factsLine,
      stateLine,
      `本轮意图：${intent || '自然推进'}`,
      guidance ? `意图说明：${guidance}` : '',
      `参考表达（仅供语气参考，不必照抄；必须根据学员上一句的实质内容自然回应）：${ruleReply}`,
      dialogue ? `最近对话：\n${dialogue}` : '',
      intentLine,
      '硬性要求：1) 先接住学员上一句里你最关心的点（承认/反驳/追问），再推进你的意图；2) 你始终是顾客本人，绝不说服务方话术（如「我帮您跟进」「马上告诉您」「您看还有什么需要帮忙」）；3) 只围绕角色卡和锁定事实，不得新增事实、投诉点或产品知识；4) 不要重复已经问过的问题；5) 口语自然，像真实对话，一句话，不超过90字。',
      '只输出 JSON：{"intent":"简短意图标签","reply":"你的原话"}',
    ].filter(Boolean).join('\n');
    const r = await callLLM(
      [{ role: 'user', content: prompt }],
      {
        purpose: 'talent_engine_customer_actor',
        temperature: 0.7,
        max_tokens: 240,
        skipCache: true,
        trackTier: true,
      }
    );
    const raw = String(r?.content || r?.text || '').trim();
    const lastCustomer = priorCustomerTexts[priorCustomerTexts.length - 1] || '';
    const parsed = extractJsonReply(raw);
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.reply === 'string' && isValidGeneratedReply(parsed.reply, lastCustomer)) {
        return { reply: parsed.reply, intent: String(parsed.intent || intent) };
      }
      return { reply: ruleReply, intent };
    }
    // 模型没输出 JSON 但给了可用原话 → 接受
    if (isValidGeneratedReply(raw, lastCustomer)) return { reply: raw, intent };
  } catch (_) {
    /* fall back */
  }
  return { reply: ruleReply, intent };
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
    if (r?.ok !== false && text && text.length < 120 && !CUSTOMER_SERVICE_VOICE_RE.test(text)) return text;
  } catch (_) {
    /* fall back */
  }
  return ruleReply;
}
