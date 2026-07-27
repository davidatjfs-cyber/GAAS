/**
 * AI quality learning scheduler LLM prompt handlers (P18 peel from index.js).
 */
export function createAiQualitySchedulerHandlers(deps) {
  const { callLLM, runPlatformQualityModelTask, pool } = deps;

  async function generateCandidate({ route, samples, evidence }) {
    const result = await runPlatformQualityModelTask(pool, {
      operation: 'generate_prompt_patch',
      route,
      execute: () => callLLM([
        {
          role: 'system',
          content: `你是平台AI质量工程师。根据已脱敏、跨租户汇总的失败样本，为指定路由提出一个最小提示词补丁。
只能总结共性，不得复原或猜测租户、员工、顾客身份，不得照抄样本中的专有名词或数字。
严格返回JSON：{"problem_pattern":"共性问题","prompt_patch":"可追加到系统提示词的明确规则","risk":"潜在副作用","evaluation_focus":["评测重点"]}`,
        },
        {
          role: 'user',
          content: JSON.stringify({ route, evidence, samples }, null, 2).slice(0, 24000),
        },
      ], {
        purpose: 'quality_improvement',
        platformQuality: true,
        temperature: 0,
        max_tokens: 800,
        skipCache: true,
      }),
    });
    if (!result?.ok || !result.content) return null;
    const text = String(result.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  async function evaluateCandidate({ route, samples, proposal, evidence }) {
    const result = await runPlatformQualityModelTask(pool, {
      operation: 'evaluate_prompt_patch',
      route,
      execute: () => callLLM([
        {
          role: 'system',
          content: `你是独立AI质量评测器。对已脱敏失败样本与候选提示词补丁进行离线对比评测。
不得猜测或恢复任何身份。只判断补丁能否纠正共性错误、是否有事实依据、是否引入安全风险。
严格返回JSON：{"quality_score":0到1,"groundedness":0到1,"safety_violation_rate":0到1,"negative_feedback_rate":0到1,"p95_latency_ms":0,"rationale":"不超过100字"}`,
        },
        {
          role: 'user',
          content: JSON.stringify({ route, evidence, proposal, samples }, null, 2).slice(0, 24000),
        },
      ], {
        purpose: 'quality_improvement_evaluation',
        platformQuality: true,
        temperature: 0,
        max_tokens: 500,
        skipCache: true,
      }),
    });
    if (!result?.ok || !result.content) return null;
    const text = String(result.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  return { generateCandidate, evaluateCandidate };
}
