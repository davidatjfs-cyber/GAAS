/**
 * 客户 AI 一轮对话：策略机 → LLM 生成 → 闸门
 */
import { SALES_PERSONA, PUBLIC_KNOWLEDGE } from './sales-knowledge.js';
import { buildStrategyPlan, sanitizeReply, templateReply, containsPriceMention } from './sales-strategy.js';

let _callLLM = null;
export function setSalesCustomerAiLlm(fn) {
  _callLLM = fn;
}

function historyToPrompt(messages = []) {
  return (messages || [])
    .slice(-8)
    .map((m) => `${m.direction === 'inbound' ? '客户' : '顾问'}：${m.content}`)
    .join('\n');
}

async function generateWithLlm(plan, userText, history) {
  if (typeof _callLLM !== 'function') return null;
  const knowledgeBlurb = PUBLIC_KNOWLEDGE.map((k) => `- ${k.title}：${k.body}`).join('\n');
  const system = `${SALES_PERSONA.system_role}

【可引用的公开知识】
${knowledgeBlurb}

【本轮策略（必须遵守）】
模式=${plan.mode}
下一问=${plan.next_question?.question || '（可不问）'}
是否转人工=${plan.takeover.takeover ? '是' : '否'}
价格规则=绝对禁止提及任何具体价格数字/折扣比例（包括金额、折扣、报价范围）。客户问价格一律引导"由顾问为您详细说明"，不得自行报价。
已确认信息=${JSON.stringify(plan.extracted || {})}
`;

  const user = `对话历史：
${historyToPrompt(history) || '（新会话）'}

客户本轮说：${userText}

请给出顾问的下一句回复。只输出对客户说的话，不要输出分析。`;

  const r = await _callLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { purpose: 'sales_customer_ai', temperature: 0.45, max_tokens: 280, skipCache: true }
  ).catch(() => null);
  if (!r?.ok || !r.content) return null;
  return String(r.content).trim();
}

export async function runCustomerAiTurn({ userText, extracted, history, intentScore, controller, guidance = null }) {
  const plan = buildStrategyPlan({ userText, extracted, history, intentScore, controller });
  if (guidance?.question_slot) {
    const forced = (plan.next_question?.key === guidance.question_slot) || guidance.question_slot;
    if (typeof forced === 'object') plan.next_question = forced;
    else plan.guidance_question_slot = forced;
  }

  let reply = await generateWithLlm(plan, userText, history);
  let source = 'llm';
  if (!reply) {
    reply = templateReply(plan, userText);
    source = 'template';
  }
  reply = sanitizeReply(reply);

  if (plan.mode === 'handoff') {
    reply = sanitizeReply(templateReply(plan, userText));
    source = 'handoff_template';
  } else if (containsPriceMention(reply)) {
    // 第二道防线：策略机没有判定为转人工场景，但LLM回复里仍然出现了具体价格数字/折扣，
    // 强制改为转人工模板，并把 takeover 标记为真，确保下游(sales-session.js)真正执行
    // 人工接管，而不只是话术上"听起来像转人工"。
    plan.mode = 'handoff';
    plan.takeover = { ...plan.takeover, takeover: true, reason: 'price_leak_guard' };
    reply = sanitizeReply(templateReply(plan, userText));
    source = 'handoff_template_price_guard';
  }

  if (plan.next_question?.question && plan.mode !== 'handoff' && !/[？?]/.test(reply)) {
    reply = sanitizeReply(`${reply} ${plan.next_question.question}`);
  }

  return { ok: true, reply, source, plan, guidance };
}
