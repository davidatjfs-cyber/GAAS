/**
 * HQ Planner — LLM 输出 JSON 修复
 * 从 hq-planner-agent.js 拆出。ctx.callLLMTiered 由调用方注入（避免反向 import）。
 */
import { extractFirstJsonObject } from './plan-data.js';

export async function repairPlanJson(ctx, rawContent, role) {
  const parsed = extractFirstJsonObject(rawContent);
  if (parsed) return parsed;
  const repaired = await ctx.callLLMTiered([
    {
      role: 'system',
      content: '你是JSON修复器。把输入内容转换成合法JSON对象。仅返回JSON，不要任何解释。JSON键必须是:title,summary,rootCauses,actions,expectedOutcome,dataGaps。'
    },
    { role: 'user', content: String(rawContent || '') }
  ], role, { purpose: 'analysis', temperature: 0, maxTokens: 1800, skipCache: true });
  if (!repaired?.ok) return null;
  return extractFirstJsonObject(repaired.content || '');
}
