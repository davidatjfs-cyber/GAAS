const banned = /\b(ontology|metric|schema|json|sql|api|id)\b|指标ID|技术字段/i;

export function cleanBossText(text = '', fallback = '当前数据不足，暂无法形成明确经营判断。') {
  const value = String(text || '').trim();
  if (!value) return fallback;
  return banned.test(value) ? fallback : value;
}

export function buildBossReportFields({ title, summary, findings = [], actions = [], riskWarning = '', expectedImpact = '', actualImpact = '', confidenceNote = '' } = {}) {
  return {
    boss_title: cleanBossText(title, '本期经营闭环复盘'),
    boss_summary: cleanBossText(summary),
    key_findings_for_owner: findings.map(x => cleanBossText(x)).filter(Boolean),
    next_actions_for_owner: actions.map(x => cleanBossText(x)).filter(Boolean),
    risk_warning: cleanBossText(riskWarning, '当前未发现需要立即升级的风险。'),
    expected_business_impact: cleanBossText(expectedImpact, '建议先把动作落到人，再用回店、复购和营业额验证效果。'),
    actual_business_impact: actualImpact ? cleanBossText(actualImpact) : '',
    confidence_note: cleanBossText(confidenceNote, '判断基于当前可用经营数据，数据不足的部分不会强行下结论。'),
  };
}

export function summarizeIssueForBoss(issue = {}) {
  const map = {
    revenue_decline: '生意结果开始掉头，需要先看客流、复购和午市有没有同步下滑。',
    repeat_decline: '老客回来变少，说明客户维护没有形成稳定回店。',
    customer_asset_risk: '客户池有流失风险，高价值客户和沉睡客户要尽快被接住。',
    staff_execution_risk: '员工执行没有闭环，发现的问题可能没有真正改完。',
    marketing_ineffective: '营销做了，但客户没有明显回来，权益和客群组合需要复盘。',
  };
  return map[issue.issue_type] || issue.issue_title || '当前存在一个需要跟进的经营问题。';
}

export function summarizeOpportunityForBoss(opportunity = {}) {
  const map = {
    dormant_customer_reactivation: '优先唤醒沉睡客户，把已有客户池重新带回门店。',
    vip_retention: '先维护高价值客户，避免核心贡献客户悄悄流失。',
    new_customer_second_visit: '把新客二次回店接住，让新增客户变成稳定客户。',
    stored_value_customer_activation: '推动储值客户回店消费，让钱收进来以后真的形成营业额。',
    low_repeat_dish_optimization: '复盘低复购菜品，先改出品稳定性和推荐动作。',
    lunch_revenue_recovery: '午市要单独拆解客群和套餐，不能只看全天营业额。',
    negative_review_recovery: '差评要转成整改动作，先修复客户感受。',
    staff_execution_improvement: '把任务落到岗位和截止时间，避免问题停在发现层。',
  };
  return map[opportunity.opportunity_type] || opportunity.title || '把本期机会转成可执行动作。';
}
