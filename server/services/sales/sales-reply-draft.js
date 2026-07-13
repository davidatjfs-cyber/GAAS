/**
 * 销售话术生成：为人工接管后的销售生成「可直接发给客户」的草稿文本
 * （区别于 sales-ops.js 的 buildSalesAdvice——那是给内部人看的建议摘要）
 */
import { SALES_PERSONA, PUBLIC_KNOWLEDGE } from './sales-knowledge.js';
import { sanitizeReply } from './sales-strategy.js';

let _callLLM = null;

export function setSalesReplyDraftLlm(fn) {
  _callLLM = fn;
}

function historyToPrompt(messages = []) {
  return (messages || [])
    .slice(-8)
    .map((m) => `${m.direction === 'inbound' ? '客户' : '顾问'}：${m.content}`)
    .join('\n');
}

export async function draftCustomerReply({ lead, messages, advice } = {}) {
  if (typeof _callLLM !== 'function') return { ok: false, error: 'llm_unavailable' };
  const knowledgeBlurb = PUBLIC_KNOWLEDGE.map((k) => `- ${k.title}：${k.body}`).join('\n');
  const l = lead || {};
  const system = `${SALES_PERSONA.system_role}

【可引用的公开知识】
${knowledgeBlurb}

【客户已确认信息】
门店数：${l.store_count ?? '未明'}｜城市：${l.city || '未明'}｜品类：${l.cuisine || '未明'}
POS：${l.pos_brand || '未明'}｜手机号数据：${l.phone_data_ready == null ? '未明' : (l.phone_data_ready ? '有' : '无')}
痛点：${l.extracted?.pain_point || (l.pain_points || [])[0] || '未明'}｜阶段：${l.stage || '未明'}

【内部建议参考（不要照抄给客户）】
${advice || '（无）'}
`;

  const user = `对话历史：
${historyToPrompt(messages) || '（无历史）'}

请为销售顾问写一段可以直接复制发送给客户的回复文本，语气专业克制，不输出分析，只输出这段回复本身。`;

  const r = await _callLLM(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { purpose: 'sales_reply_draft', temperature: 0.45, max_tokens: 280, skipCache: true }
  ).catch(() => null);

  if (!r?.ok || !r.content) return { ok: false, error: 'llm_failed' };
  return { ok: true, text: sanitizeReply(String(r.content).trim()) };
}
