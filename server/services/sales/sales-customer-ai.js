/**
 * 客户 AI 一轮对话：策略机 → LLM 生成 → 闸门
 */
import { SALES_PERSONA, PUBLIC_KNOWLEDGE } from './sales-knowledge.js';
import { buildStrategyPlan, sanitizeReply, templateReply } from './sales-strategy.js';

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
允许谈价格细节=${plan.allow_price_talk ? '否，只可讲原则' : '否'}
已确认信息=${JSON.stringify(plan.extracted || {})}
`;

  const user = `对话历史：
${historyToPrompt(history) || '（新会话）'}

客户本轮说：${userText}

请给出顾问的下一句回复。只输出对客户说的话，不要输出分析。`;

  const r = await _callLLM(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { purpose: 'sales_customer_ai', temperature: 0.45, max_tokens: 280, skipCache: true }
  ).catch(() => null);

  if (!r?.ok || !r.content) return null;
  return String(r.content).trim();
}

export async function runCustomerAiTurn({ userText, extracted, history, intentScore, controller }) {
  const plan = buildStrategyPlan({
    userText,
    extracted,
    history,
    intentScore,
    controller,
  });

  let reply = await generateWithLlm(plan, userText, history);
  let source = 'llm';
  if (!reply) {
    reply = templateReply(plan, userText);
    source = 'template';
  }
  reply = sanitizeReply(reply);

  // 闸门：转人工模式下强制手写话术，避免 LLM 继续报价
  if (plan.mode === 'handoff') {
    reply = sanitizeReply(templateReply(plan, userText));
    source = 'handoff_template';
  }

  // 若策略要求提问但回复无问号，补上下一问
  if (plan.next_question?.question && plan.mode !== 'handoff' && !/[？?]/.test(reply)) {
    reply = sanitizeReply(`${reply} ${plan.next_question.question}`);
  }

  return {
    ok: true,
    reply,
    source,
    plan,
  };
}
