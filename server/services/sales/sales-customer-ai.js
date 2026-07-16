/**
 * 客户 AI 一轮对话：策略机 → LLM 生成 → 闸门
 */
import { SALES_PERSONA, PUBLIC_KNOWLEDGE } from './sales-knowledge.js';
import { buildStrategyPlan, sanitizeReply, templateReply, containsPriceMention, diagnosisCta } from './sales-strategy.js';
import { recommendCasesForLead, formatCaseBlurb } from './sales-case-library.js';

let _callLLM = null;
export function setSalesCustomerAiLlm(fn) {
  _callLLM = fn;
}

/**
 * 客户短时间内反复问同一件事(比如连续测试"能语音吗")时，如果原样把每一条都塞进历史，
 * 大模型会被这种高密度重复"带偏"，倾向于顺着历史模式续写而忽略客户最新这一句真正问的
 * 是什么(实测复现：客户测完语音后正常回答"上海，北京"，AI却又重复了几轮前的语音拒绝话术)。
 * 这里把连续3条以上高度相似的同方向消息折叠成一条摘要，避免历史里同一句话反复出现挤占大模型注意力。
 */
function collapseRepeats(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.direction === m.direction && similar(last.content, m.content)) {
      last.count = (last.count || 1) + 1;
      last.content = m.content; // 保留最新一次的原话
    } else {
      out.push({ ...m, count: 1 });
    }
  }
  return out;
}

function similar(a = '', b = '') {
  const na = String(a).replace(/[，。？！\s]/g, '');
  const nb = String(b).replace(/[，。？！\s]/g, '');
  if (!na || !nb) return false;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  return longer.includes(shorter.slice(0, Math.max(2, Math.floor(shorter.length * 0.6))));
}

function historyToPrompt(messages = []) {
  const collapsed = collapseRepeats((messages || []).slice(-8));
  return collapsed
    .map((m) => {
      const who = m.direction === 'inbound' ? '客户' : '顾问';
      const repeatNote = m.count > 1 ? `(类似内容连续问了${m.count}次)` : '';
      return `${who}：${m.content}${repeatNote}`;
    })
    .join('\n');
}

async function generateWithLlm(plan, userText, history, knowledgeItems, intentScore = 0) {
  if (typeof _callLLM !== 'function') return null;
  const items = Array.isArray(knowledgeItems) && knowledgeItems.length ? knowledgeItems : PUBLIC_KNOWLEDGE;
  const knowledgeBlurb = items.map((k) => `- ${k.title}：${k.body}`).join('\n');
  const diagnosisBlurb = plan.mode === 'diagnosis_complete' && plan.diagnosis
    ? `\n【本轮必须先给出经营诊断结论，再引导下一步】
核心问题=${plan.diagnosis.surface_problem}
背后原因=${(plan.diagnosis.root_causes || []).slice(0, 2).join('；')}
建议优先解决=${(plan.diagnosis.recommended_modules || []).slice(0, 3).join('、')}
${plan.caseBlurb ? `可引用的同类客户案例=${plan.caseBlurb}\n` : ''}诊断后的转化动作（必须作为结尾）=${diagnosisCta(intentScore)}
`
    : '';
  const system = `${SALES_PERSONA.system_role}

【可引用的公开知识】
${knowledgeBlurb}
${diagnosisBlurb}
【最高优先级规则】无论"对话历史"里出现过什么内容、客户之前问过多少次相似的问题，本轮
回复必须是对"客户本轮说"这一句话的直接回应——历史只用来理解背景，不能照抄或延续历史里
最近出现的话术模式。如果本轮客户说的内容和历史明显不是一回事(比如历史在聊语音通话、
本轮客户其实在回答店数/城市这类问题)，必须切换到回应本轮内容，不能停留在历史话题上。

【本轮策略（必须遵守）】
模式=${plan.mode}
下一问=${plan.next_question?.question ? `必须在本轮问这个问题（除非客户本轮的话需要先直接回应）：${plan.next_question.question}` : '（可不问）'}
是否转人工=${plan.takeover.takeover ? '是' : '否'}
价格规则=绝对禁止提及任何具体价格数字/折扣比例（包括金额、折扣、报价范围）。客户问价格一律引导"由顾问为您详细说明"，不得自行报价。
联系方式规则=${!plan.extracted?.phone && plan.extracted?.pain_point ? '客户还没留手机号，且已经聊到具体痛点了——本轮结尾一定要自然地问一句手机号，方便顾问后续直接联系、发资料，不能跳过这一步。' : '客户已经留过手机号或还没聊到痛点，不要再重复问手机号。'}
已确认信息=${JSON.stringify(plan.extracted || {})}
`;

  const user = `对话历史(仅供理解背景，不要照抄延续)：
${historyToPrompt(history) || '（新会话）'}

客户本轮说：${userText}

请只针对"客户本轮说"这句话给出顾问的下一句回复，不要重复历史里已经说过的话。只输出对客户说的话，不要输出分析。`;

  const r = await _callLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { purpose: 'sales_customer_ai', temperature: 0.45, max_tokens: 280, skipCache: true }
  ).catch(() => null);
  if (!r?.ok || !r.content) return null;
  return String(r.content).trim();
}

export async function runCustomerAiTurn({ userText, extracted, history, intentScore, controller, guidance = null, knowledgeItems = null, pool = null }) {
  const plan = buildStrategyPlan({ userText, extracted, history, intentScore, controller, knowledgeItems });
  if (guidance?.question_slot) {
    const forced = (plan.next_question?.key === guidance.question_slot) || guidance.question_slot;
    if (typeof forced === 'object') plan.next_question = forced;
    else plan.guidance_question_slot = forced;
  }

  if (plan.mode === 'diagnosis_complete' && pool) {
    const cases = await recommendCasesForLead(pool, { extracted: plan.extracted }).catch(() => []);
    plan.caseBlurb = cases?.[0]?._score > 0 ? formatCaseBlurb(cases[0]) : '';
  }

  let reply = await generateWithLlm(plan, userText, history, knowledgeItems, intentScore);
  let source = 'llm';
  if (!reply) {
    reply = templateReply(plan, userText, intentScore);
    source = 'template';
  }
  reply = sanitizeReply(reply);

  if (plan.mode === 'handoff') {
    reply = sanitizeReply(templateReply(plan, userText, intentScore));
    source = 'handoff_template';
  } else if (containsPriceMention(reply)) {
    // 第二道防线：策略机没有判定为转人工场景，但LLM回复里仍然出现了具体价格数字/折扣，
    // 强制改为转人工模板，并把 takeover 标记为真，确保下游(sales-session.js)真正执行
    // 人工接管，而不只是话术上"听起来像转人工"。
    plan.mode = 'handoff';
    plan.takeover = { ...plan.takeover, takeover: true, reason: 'price_leak_guard' };
    reply = sanitizeReply(templateReply(plan, userText, intentScore));
    source = 'handoff_template_price_guard';
  }

  if (plan.next_question?.question && plan.mode !== 'handoff' && !/[？?]/.test(reply)) {
    reply = sanitizeReply(`${reply} ${plan.next_question.question}`);
  }

  return { ok: true, reply, source, plan, guidance };
}
