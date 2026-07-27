/**
 * HQ Planner — 行动计划回复文案格式化 (纯函数)
 * 从 hq-planner-agent.js 拆出。
 */

export function formatPlanReply(result, targetStore) {
  const planData = result.plan || {};
  const lines = [];
  lines.push(`📋 行动计划 [${result.planId}]`);
  lines.push(`门店：${targetStore} ｜ 健康分：${result.healthScore}/100`);
  lines.push('');
  lines.push(`📌 计划主题：${planData.title || '改善计划'}`);
  lines.push(`摘要：${planData.summary || '-'}`);
  if (Array.isArray(planData.rootCauses) && planData.rootCauses.length) {
    lines.push('');
    lines.push('🔍 核心根因');
    planData.rootCauses.slice(0, 5).forEach((c, i) => lines.push(`${i + 1}. ${c}`));
  }
  if (Array.isArray(planData.actions) && planData.actions.length) {
    lines.push('');
    lines.push('📝 行动清单');
    planData.actions.slice(0, 6).forEach((a, i) => {
      lines.push(`${i + 1}) ${a.action}`);
      lines.push(`   负责人: ${a.responsibleRole || '-'} ｜ 时限: ${a.deadline || '-'} ｜ KPI: ${a.kpiTarget || '-'}`);
      lines.push(`   验收: ${a.verificationMethod || '-'}`);
    });
  }
  if (planData.expectedOutcome) {
    lines.push('');
    lines.push(`🎯 预期结果：${planData.expectedOutcome}`);
  }
  if (Array.isArray(planData.dataGaps) && planData.dataGaps.length) {
    lines.push(`💡 数据补充：${planData.dataGaps.join('；')}`);
  }
  if (result.compliance?.passed === false) {
    const issues = [];
    const checks = result.compliance?.checks || {};
    for (const [, v] of Object.entries(checks)) {
      if (!v?.passed && Array.isArray(v?.issues)) issues.push(...v.issues);
    }
    if (issues.length) lines.push(`⚠️ 合规提示：${issues.join('；')}`);
  }
  if (result.status === 'pending_review') {
    lines.push('');
    lines.push(`回复“审批通过 ${result.planId}”可下发执行。`);
  }
  return lines.filter(Boolean).join('\n');
}
