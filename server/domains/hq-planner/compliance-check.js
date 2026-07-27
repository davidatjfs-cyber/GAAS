/**
 * HQ Planner — Compliance Guard (合规审查)
 * 从 hq-planner-agent.js 拆出。ctx = { callLLMTiered, log }。
 */
import { buildCompliancePrompt } from './prompts.js';

export async function runComplianceCheck(ctx, planData, context) {
  const { log } = ctx;
  try {
    const { store, storeHealth, graphContext, tasksSummary, scoresSummary, role } = context;

    const compliancePrompt = buildCompliancePrompt({ store, storeHealth, graphContext, tasksSummary, scoresSummary, planData });

    const complianceResult = await ctx.callLLMTiered([
      { role: 'system', content: compliancePrompt },
      { role: 'user', content: '请审查上述行动计划的合规性。' }
    ], role, { purpose: 'analysis', temperature: 0, maxTokens: 2048 });

    if (!complianceResult.ok) {
      return { passed: false, error: 'compliance_llm_failed', checks: {}, overallComment: complianceResult.error };
    }

    try {
      const cleaned = complianceResult.content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      // 保守策略: 解析失败则不通过
      return {
        passed: false,
        checks: {},
        overallComment: `合规审查解析失败: ${complianceResult.content?.slice(0, 200)}`,
        rawResponse: complianceResult.content
      };
    }
  } catch (e) {
    log.error({ msg: 'compliance_check_failed', err: e?.message });
    return { passed: false, error: 'compliance_error', checks: {}, overallComment: e?.message };
  }
}
