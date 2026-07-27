import { normalizeIntentPlan, tryParseJsonObjectFromText } from './function-calling-tools.js';

export async function buildBiIntentPlan(deps, text, safeStore, conversationHistory = [], senderRole = '') {
  const { callLLM, getBiReasoningModel } = deps;
  const historyHint = conversationHistory.length
    ? `\n\n最近对话记录（用于理解追问/上下文）：\n${conversationHistory.map(h => h.role === 'user' ? `用户: ${h.q} [工具:${h.tool||'无'}]` : `助手: ${h.a}`).join('\n')}`
    : '';
  const planner = await callLLM(
    [
      {
        role: 'system',
        content: `你是BI意图识别器。\n仅输出JSON，不要额外文字。\n候选intent：query_sales_ranking、query_complaint_product_ranking、query_revenue_summary、query_revenue_forecast_next_day、query_table_visit、marketing_plan_request、other。\n输出格式：{"intent":"...","confidence":0-1,"params":{...}}\nparams仅允许：period_days,lookback_days,limit,sort_order,metric,biz_type,product_name。\n若用户问"最差/倒数/垫底"则sort_order=asc；问"最好/最多/TOP"则sort_order=desc。\n当前门店：${safeStore}（只用于理解上下文，最终权限以后端为准）。\n\n【最高优先级规则-先判断再看其他】：\n- 只要用户消息包含"方案""计划""策略""如何提升""怎么提升""怎样提升""如何增加""怎么增加""行动计划""具体方案"等规划性词汇，无论是否也含有"营收""销售""数据"等词，一律识别为 marketing_plan_request，confidence=1。\n- 仅当用户是纯粹查询数据（如"查一下营收""看看销售额""最近数据""上周多少钱"）时才使用 query_xxx 类型。\n- 若用户要求"做营销方案""推广方案""新品方案""活动策划""行动方案"等战略规划类请求，识别为 marketing_plan_request，confidence=1，params中用product_name记录产品名（如有）。\n\n重要：用户可能在追问上一轮的结果（比如"给我10样""排前10呢""具体投诉什么"），请结合对话记录理解真实意图。若追问内容明显关联上一轮工具，复用同一intent并调整params（如limit/sort_order）。${historyHint}`
      },
      { role: 'user', content: String(text || '') }
    ],
    {
      model: getBiReasoningModel(),
      temperature: 0,
      max_tokens: 220,
      skipCache: true,
      role: senderRole,
      purpose: 'analysis'
    }
  );
  const parsed = tryParseJsonObjectFromText(planner?.content || '');
  if (!parsed) return { intent: 'other', confidence: 0, params: {} };
  return normalizeIntentPlan(parsed);
}

export async function narrateBiToolResult(deps, userText, toolText, store, senderRole = '') {
  const { callLLM, getBiReasoningModel } = deps;
  const narr = await callLLM(
    [
      {
        role: 'system',
        content: `你是门店BI助手。请把工具查询结果转成简洁可执行的中文回答。\n严格要求：\n1) 只能使用"工具结果"中出现的事实，不得新增数字或臆造菜品名称\n2) 结论先行，最多200字\n3) 保留关键口径（例如TOP/倒数、近N天）\n4) 若工具结果提示样本不足/暂无数据，直接如实说明，不要猜测\n5) 严格区分数据来源：桌访（table_visit_records）是门店服务员巡台记录，差评（bad_reviews）是大众点评/美团线上评价，不能混用"投诉""差评"等词描述桌访数据\n6) 桌访数据请用"桌访反馈""桌访不满意"等表述，差评数据才用"投诉""差评"等表述\n7) 禁止臆造菜品名称（如"卤鹅"等），只能使用工具结果中明确列出的菜品\n8) 如果工具结果为空或无具体菜品，必须明确说明"暂无数据"，不得编造示例`
      },
      {
        role: 'user',
        content: `用户问题：${String(userText || '')}\n门店：${String(store || '')}\n工具结果：\n${String(toolText || '')}`
      }
    ],
    {
      model: getBiReasoningModel(),
      temperature: 0.1,
      max_tokens: 260,
      skipCache: true,
      role: senderRole,
      purpose: 'reasoning'
    }
  );
  const content = String(narr?.content || '').trim();
  return content || toolText;
}
