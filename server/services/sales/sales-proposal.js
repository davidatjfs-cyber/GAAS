/**
 * LLM 销售方案生成 + 深诊断
 */
let _callLLM = null;
export function setSalesProposalLlm(fn) { _callLLM = fn; }

export async function generateSalesProposal({ lead, diagnosis, cases = [], funnel = {} }) {
  const customer = lead.company || lead.name || lead.lead_key;
  const pain = lead.extracted?.pain_point || (lead.pain_points || [])[0] || '经营增长';
  const template = [
    `# ${customer} — GAAS 增长方案（草案）`,
    '',
    `## 客户概况`,
    `- 门店数：${lead.store_count ?? '待确认'}`,
    `- 城市/菜系：${lead.city || '—'} / ${lead.cuisine || '—'}`,
    `- POS：${lead.pos_brand || '待确认'}`,
    `- 核心痛点：${pain}`,
    `- 意向评分：${lead.intent_score ?? 0}（${lead.intent_level || 'low'}）`,
    '',
    `## 问题诊断`,
    diagnosis?.surface_problem || '待深度诊断',
    ...(diagnosis?.root_causes || []).map((r) => `- ${r}`),
    '',
    `## 推荐模块`,
    ...(diagnosis?.recommended_modules || ['客户自动维护', '门店自主运营', '老板日报']).map((m) => `- ${m}`),
    '',
    `## 匹配案例`,
    ...cases.slice(0, 3).map((c) => `- ${c.title}：${c.summary || ''}`),
    '',
    `## 30天试跑建议`,
    '- 选1家代表性门店试跑',
    '- 验证指标：老客回店数、营业额变化、执行完成率',
    '- 试跑结束后出具 ROI 报告',
    '',
    `## 下一步`,
    lead.next_action || '预约 Demo 并确认决策人',
  ].join('\n');

  if (typeof _callLLM !== 'function') return { ok: true, text: template, source: 'template' };

  const system = `你是 GAAS 餐厅增长顾问，撰写对客户可发送的销售方案草案。禁止过度承诺（全POS可接、保证涨营业额、随意折扣）。结构清晰，500字以内。`;
  const user = `客户档案：${JSON.stringify({
    customer, store_count: lead.store_count, pain, pos: lead.pos_brand, score: lead.intent_score,
    modules: diagnosis?.recommended_modules, cases: cases.map((c) => c.title),
  })}\n\n请输出完整方案正文（Markdown）。`;

  const r = await _callLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { purpose: 'sales_proposal', temperature: 0.4, max_tokens: 900, skipCache: true }
  ).catch(() => null);

  if (r?.ok && r.content) return { ok: true, text: String(r.content).trim(), source: 'llm' };
  return { ok: true, text: template, source: 'template_fallback' };
}

export async function runDeepDiagnosis({ lead, messages = [], ruleDiagnosis }) {
  const base = ruleDiagnosis || {};
  if (typeof _callLLM !== 'function') {
    return { ok: true, diagnosis: base, source: 'rules' };
  }

  const history = (messages || []).slice(-12).map((m) => `${m.sender || m.direction}: ${m.content}`).join('\n');
  const system = `你是销售诊断专家。基于对话与档案，补充规则诊断的盲点。输出 JSON：{"surface_problem":"","root_causes":[],"recommended_modules":[],"avoid_modules":[],"sales_advice":"","risks":[]}`;
  const user = `档案：${JSON.stringify({
    company: lead.company, store_count: lead.store_count, pain: lead.extracted?.pain_point,
    tags: lead.tags, stage: lead.stage, score: lead.intent_score,
  })}\n规则诊断：${JSON.stringify(base)}\n\n对话：\n${history || '无'}`;

  const r = await _callLLM(
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { purpose: 'sales_deep_diagnosis', temperature: 0.3, max_tokens: 600, skipCache: true }
  ).catch(() => null);

  if (!r?.ok || !r.content) return { ok: true, diagnosis: base, source: 'rules_fallback' };

  try {
    const parsed = JSON.parse(String(r.content).replace(/```json|```/g, '').trim());
    return {
      ok: true,
      source: 'llm',
      diagnosis: {
        surface_problem: parsed.surface_problem || base.surface_problem,
        root_causes: parsed.root_causes?.length ? parsed.root_causes : base.root_causes,
        recommended_modules: parsed.recommended_modules?.length ? parsed.recommended_modules : base.recommended_modules,
        avoid_modules: parsed.avoid_modules?.length ? parsed.avoid_modules : base.avoid_modules,
        sales_advice: parsed.sales_advice || base.sales_advice,
        risks: parsed.risks || [],
      },
    };
  } catch {
    return { ok: true, diagnosis: { ...base, sales_advice: `${base.sales_advice || ''}\n${String(r.content).slice(0, 300)}` }, source: 'llm_text' };
  }
}
