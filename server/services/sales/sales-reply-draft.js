/**
 * 销售话术生成：为人工接管后的销售生成「可直接发给客户」的草稿文本
 */
import { SALES_PERSONA, PUBLIC_KNOWLEDGE } from './sales-knowledge.js';
import { sanitizeReply } from './sales-strategy.js';
import { recommendCaseTheme, recommendAssets, recommendNextSteps } from './sales-tags.js';
import { getObjectionResponse } from './sales-diagnosis.js';

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
  const role = l.decision_role || '客户';
  const theme = recommendCaseTheme(l);
  const assets = recommendAssets(l);
  const nextSteps = recommendNextSteps(l).join('；');
  const system = `${SALES_PERSONA.system_role}

【可引用的公开知识】
${knowledgeBlurb}

【客户已确认信息】
称呼：${role === '老板' ? '王总' : '负责人'}｜门店数：${l.store_count ?? '未明'}｜城市：${l.city || '未明'}｜品类：${l.cuisine || '未明'}
POS：${l.pos_brand || '未明'}｜手机号数据：${l.phone_data_ready == null ? '未明' : (l.phone_data_ready ? '有' : '无')}
痛点：${l.extracted?.pain_point || (l.pain_points || [])[0] || '未明'}｜阶段：${l.stage || '未明'}｜角色：${role}

【沟通目标】
推荐案例：${theme}
可发资料：${assets.join('、')}
下一步：${nextSteps}

【内部建议参考（不要照抄给客户）】
${advice || '（无）'}
`;

  const user = `对话历史：
${historyToPrompt(messages) || '（无历史）'}

请为销售顾问写一段可以直接复制发送给客户的回复文本，语气专业克制，针对${role}的沟通风格，不输出分析，只输出这段回复本身。`;

  const r = await _callLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { purpose: 'sales_reply_draft', temperature: 0.45, max_tokens: 320, skipCache: true }
  ).catch(() => null);
  if (!r?.ok || !r.content) return { ok: false, error: 'llm_failed' };
  return { ok: true, text: sanitizeReply(String(r.content).trim()) };
}

export function draftStandardResponse(objectionKey) {
  const obj = getObjectionResponse(objectionKey);
  if (!obj) return { ok: false, error: 'unknown_objection' };
  return { ok: true, label: obj.label, text: obj.response };
}

export function draftQuickReplyByScenario({ lead, scenario }) {
  const l = lead || {};
  const pain = l.extracted?.pain_point || (l.pain_points || [])[0] || '经营增长';
  const assets = recommendAssets(l);
  const theme = recommendCaseTheme(l);

  const templates = {
    request_demo: `结合您提到的${pain}问题，我建议先安排一次 30 分钟在线演示，重点看${theme}。您方便这周三或周五下午吗？`,
    request_trial: `我们一般建议先跑 30 天试跑，验证数据条件和${pain}改善效果。您方便提供一下门店的 POS 品牌和手机号覆盖情况吗？`,
    ask_price: `我们按门店规模分基础/连锁/集团方案。以您${l.store_count ? l.store_count + '家门店' : '目前的情况'}，建议先确认数据条件，再给您准确的报价区间。`,
    ask_pos: `我们不替换您的 POS，而是连接现有数据。您现在用的是${l.pos_brand || '哪家 POS'}？我可以先帮您评估接入条件。`,
    followup: `上次聊到${pain}。我这边整理了${theme}，方便给您发一份吗？`,
    send_case: `这是与您情况最接近的${theme}，供您参考。${assets[0] ? '资料名称：' + assets[0] : ''}`,
    no_decision: `理解您需要和团队/老板确认。我可以先发一份${theme}给您的团队，方便内部讨论。`,
    silence: `王总，上次聊到的${pain}，我们有个${theme}刚好匹配。您最近有时间和我们再聊聊吗？`,
  };

  const text = templates[scenario] || templates.followup;
  return { ok: true, text: sanitizeReply(text) };
}
