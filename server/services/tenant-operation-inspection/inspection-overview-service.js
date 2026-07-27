const STATUS = {
  ok: '正常',
  missing: '缺失',
  pending: '待配置',
};

const SEVERITY_DEDUCTION = { P0: 25, P1: 12, P2: 6, P3: 2 };
const RESPONSIBLE_PARTY_LABELS = {
  platform_team: '我方实施 / 系统人员',
  tenant_admin: '租户管理员',
  store_manager: '店长',
  employee: '员工',
  system_integration: '系统接口',
  customer_success: '客户成功',
};
const MODULES = ['经营诊断', '客户资产报告', '自动营销', '营销归因', '任务闭环', '人才盘点', '绩效评估', '老板晨报', '月度复盘'];
const STRUCTURAL_WATCH_KEYS = new Set([
  'customer_phone_match_rate',
  'order_phone_complete_rate',
  'order_customer_id_complete_rate',
]);

function n(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function pct(ok, total) {
  if (n(total) <= 0) return 0;
  return Math.round((n(ok) / n(total)) * 100);
}

function riskLevel(score) {
  if (score >= 90) return '健康';
  if (score >= 75) return '关注';
  if (score >= 60) return '预警';
  return '严重';
}

export function calculateHealthScore(items) {
  const deductions = (items || [])
    .filter((item) => item.status !== STATUS.ok)
    .map((item) => ({
      item_key: item.item_key,
      item_name: item.item_name,
      severity: item.severity,
      deduction: SEVERITY_DEDUCTION[item.severity] || 0,
      reason: `${item.severity} ${item.item_name}: ${item.impact_description}`,
      category: item.category,
    }));
  const totalDeduction = deductions.reduce((sum, deduction) => sum + deduction.deduction, 0);
  const healthScore = Math.max(0, 100 - totalDeduction);
  const scoreCategory = (category) => {
    const sub = (items || []).filter((item) => item.category === category);
    const bad = sub.filter((item) => item.status !== STATUS.ok).reduce(
      (sum, item) => sum + (SEVERITY_DEDUCTION[item.severity] || 0),
      0
    );
    return Math.max(0, Math.min(100, 100 - bad));
  };
  const baseScore = scoreCategory('基础配置');
  const integrationScore = scoreCategory('数据接入');
  return {
    health_score: healthScore,
    risk_level: riskLevel(healthScore),
    data_completeness: Math.round((baseScore + integrationScore) / 2),
    data_freshness: scoreCategory('数据新鲜度'),
    task_completion_rate: scoreCategory('任务闭环'),
    ai_runnable_rate: scoreCategory('AI 可运行度'),
    attribution_completeness: scoreCategory('营销归因'),
    deductions,
  };
}

function topIssues(items, limit = 3) {
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return (items || [])
    .filter((item) => item.status !== STATUS.ok)
    .sort((left, right) => (order[left.severity] ?? 9) - (order[right.severity] ?? 9))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      title: item.item_name,
      severity: item.severity,
      impact_modules: item.impact_modules,
      owner_role: item.owner_role,
      suggestion: item.suggestion,
      can_generate_task: item.can_generate_task,
    }));
}

function categoryStats(items) {
  const byCategory = new Map();
  for (const item of items || []) {
    const category = item.category || '未分类';
    if (!byCategory.has(category)) {
      byCategory.set(category, {
        category, ok_count: 0, abnormal_count: 0, missing_count: 0, delayed_count: 0,
        pending_count: 0, p0_count: 0, p1_count: 0, p2_count: 0, p3_count: 0, total: 0, ok_rate: 0,
      });
    }
    const row = byCategory.get(category);
    row.total += 1;
    if (item.status === STATUS.ok) row.ok_count += 1;
    else if (item.status === STATUS.missing) row.missing_count += 1;
    else if (item.status === '延迟') row.delayed_count += 1;
    else if (item.status === STATUS.pending) row.pending_count += 1;
    else row.abnormal_count += 1;
    const severityKey = String(item.severity || '').toLowerCase() + '_count';
    if (Object.prototype.hasOwnProperty.call(row, severityKey)) row[severityKey] += 1;
  }
  return Array.from(byCategory.values()).map((row) => ({ ...row, ok_rate: pct(row.ok_count, row.total) }));
}

function initializationStatus(items, stores) {
  const byKey = Object.fromEntries((items || []).map((item) => [item.item_key, item]));
  const required = [];
  const missingStores = !stores?.length || byKey.tenant_has_stores?.status !== STATUS.ok;
  const posBlocked = byKey.pos_data_connected?.status !== STATUS.ok;
  const customerBlocked = byKey.customer_data_updated?.status !== STATUS.ok;
  if (missingStores) required.push('先创建门店并补齐门店名称、编码和基础资料');
  if (posBlocked) required.push('接入 POS 订单明细，至少同步最近 1 天真实订单');
  if (customerBlocked) required.push('导入会员 / 客户数据，确保客户资产和自动营销有名单');
  if (missingStores) return { inspection_status: 'not_initialized', initialization_required: required };
  if (posBlocked || customerBlocked) return { inspection_status: 'pending_integration', initialization_required: required };
  return { inspection_status: 'completed', initialization_required: [] };
}

function featureAvailability(items) {
  return MODULES.map((feature) => {
    const blockers = (items || []).filter((item) => item.status !== STATUS.ok && (item.impact_modules || []).includes(feature));
    const criticalKeys = feature === '经营诊断'
      ? new Set(['tenant_has_stores', 'pos_data_connected'])
      : ['客户资产报告', '自动营销'].includes(feature)
        ? new Set(['customer_data_updated'])
        : feature === '月度复盘'
          ? new Set(['tenant_has_stores', 'pos_data_connected'])
          : new Set();
    const criticalMissing = blockers.filter((item) => criticalKeys.has(item.item_key) && item.status === STATUS.missing && item.severity === 'P0');
    const pendingConfig = blockers.filter((item) => item.status === STATUS.pending);
    const p0p1 = blockers.filter((item) => ['P0', 'P1'].includes(item.severity));
    if (feature === '月度复盘') {
      const businessBlocked = criticalMissing.some((item) => ['数据接入', '数据新鲜度'].includes(item.category));
      const attributionBlocked = blockers.some((item) => item.category === '营销归因');
      const status = businessBlocked ? '不可用' : attributionBlocked || blockers.length ? '部分可用' : '可用';
      return {
        feature,
        status,
        blocked_by: blockers.map((item) => ({ id: item.id, item_key: item.item_key, title: item.item_name, severity: item.severity })),
        reason: status === '部分可用' ? '月度复盘可以生成经营部分，少量营销效果或任务闭环指标需要结合证据校验。' : status === '不可用' ? '核心经营数据缺失，月度复盘暂不可生成。' : '月度复盘具备当前阶段的基础运行条件。',
        suggestion: blockers[0]?.suggestion || '保持经营数据、营销数据和任务结果持续同步。',
      };
    }
    const status = blockers.length === 0 ? '可用' : criticalMissing.length ? '不可用' : pendingConfig.length && p0p1.length === 0 ? '待配置' : '部分可用';
    const reason = blockers.length
      ? status === '不可用'
        ? `${feature}缺少核心数据，当前不能稳定生成。`
        : `${feature}可以运行，但受${blockers.slice(0, 2).map((item) => item.item_name).join('、')}影响，部分指标需要结合证据校验。`
      : `${feature}具备当前阶段的基础运行条件。`;
    return {
      feature,
      status,
      blocked_by: blockers.map((item) => ({ id: item.id, item_key: item.item_key, title: item.item_name, severity: item.severity })),
      reason,
      suggestion: blockers[0]?.suggestion || '保持当前数据同步和任务闭环节奏。',
    };
  });
}

function todayPriorities(items, limit = 5) {
  const severityWeight = { P0: 100, P1: 70, P2: 35, P3: 10 };
  return (items || [])
    .filter((item) => item.status !== STATUS.ok)
    .map((item) => {
      const modules = item.impact_modules || [];
      const core = modules.some((module) => ['经营诊断', '客户资产报告', '自动营销', '营销归因', '老板晨报'].includes(module));
      return { item, score: (severityWeight[item.severity] || 0) + modules.length * 8 + (core ? 25 : 0) };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => ({
      id: item.id,
      title: item.item_name,
      severity: item.severity,
      impact_modules: item.impact_modules || [],
      responsible_party: item.responsible_party,
      responsible_party_label: item.responsible_party_label || RESPONSIBLE_PARTY_LABELS[item.responsible_party] || item.owner_role,
      owner_role: item.owner_role,
      suggestion: item.suggestion,
      can_generate_task: item.can_generate_task,
      generated_task_id: item.generated_task_id || null,
    }));
}

function operationStage(items) {
  const byKey = Object.fromEntries((items || []).map((item) => [item.item_key, item]));
  if (byKey.tenant_has_stores?.status !== STATUS.ok || byKey.pos_data_connected?.status !== STATUS.ok || byKey.customer_data_updated?.status !== STATUS.ok) {
    return {
      operation_stage: 'initialization',
      operation_stage_label: '初始化阶段',
      stage_message: '当前重点是先完成基础配置和核心数据接入，否则健康分、日报和 AI 报告都没有真实依据。',
    };
  }
  const taskBlocked = (items || []).some((item) => item.category === '任务闭环' && item.status !== STATUS.ok);
  const freshnessBlocked = (items || []).some((item) => item.category === '数据新鲜度' && item.status !== STATUS.ok);
  if (taskBlocked || freshnessBlocked) {
    return {
      operation_stage: 'trial',
      operation_stage_label: '30 天试跑阶段',
      stage_message: '当前重点是稳定每日数据同步、任务执行和老板晨报完整度，让系统连续跑起来。',
    };
  }
  return {
    operation_stage: 'active',
    operation_stage_label: '正式运营阶段',
    stage_message: '当前重点可以转向增长归因、复购提升和月度复盘，用数据推动下一轮运营动作。',
  };
}

function customerSuccessRisk(score, items) {
  const actionable = (items || []).filter((item) => !STRUCTURAL_WATCH_KEYS.has(String(item.item_key || '')));
  const p0p1 = actionable.filter((item) => item.status !== STATUS.ok && ['P0', 'P1'].includes(item.severity));
  const structuralDeduction = (items || [])
    .filter((item) => item.status !== STATUS.ok && STRUCTURAL_WATCH_KEYS.has(String(item.item_key || '')))
    .reduce((sum, item) => sum + (SEVERITY_DEDUCTION[item.severity] || 0), 0);
  const adjustedScore = score.health_score == null ? null : Math.min(100, score.health_score + structuralDeduction);
  const taskBad = actionable.some((item) => item.category === '任务闭环' && item.status !== STATUS.ok && ['P1', 'P2'].includes(item.severity));
  const attrBad = actionable.some((item) => item.category === '营销归因' && item.status !== STATUS.ok && ['P1', 'P2'].includes(item.severity));
  const dailyBad = actionable.some((item) => item.impact_modules?.includes('老板晨报') && item.status !== STATUS.ok);
  const reasons = [];
  if (adjustedScore != null && adjustedScore < 60) reasons.push('健康分连续处于低位风险区间（已排除结构性手机号观察项）');
  if (p0p1.length) reasons.push(`仍有 ${p0p1.length} 个可处理 P0/P1 阻塞未处理`);
  if (taskBad) reasons.push('任务执行或审核闭环不足');
  if (attrBad) reasons.push('自动营销归因无法稳定生成');
  if (dailyBad) reasons.push('老板晨报依赖的数据或任务结果不完整');
  const level = p0p1.length >= 2 || (adjustedScore != null && adjustedScore < 60) ? 'high' : reasons.length ? 'medium' : 'low';
  return {
    customer_success_risk: level,
    customer_success_risk_label: level === 'high' ? '高' : level === 'medium' ? '中' : '低',
    customer_success_risk_reasons: reasons.length ? reasons : ['核心数据和任务闭环当前没有明显托管交付阻塞'],
    health_score_adjusted: adjustedScore,
  };
}

export function buildInspectionOverview(score, items, stores) {
  const initialization = initializationStatus(items, stores);
  const stage = operationStage(items);
  const effectiveScore = initialization.inspection_status === 'completed' ? score.health_score : null;
  const effectiveRisk = initialization.inspection_status === 'completed' ? score.risk_level : initialization.inspection_status === 'not_initialized' ? '初始化未完成' : '待接入';
  const overview = {
    ...score,
    health_score: effectiveScore,
    raw_health_score: score.health_score,
    risk_level: effectiveRisk,
    ...initialization,
    ...stage,
    category_stats: categoryStats(items),
    feature_availability: featureAvailability(items),
    today_priorities: todayPriorities(items),
    top_issues: topIssues(items, 5),
  };
  return { ...overview, ...customerSuccessRisk(overview, items) };
}

export function buildInspectionStoreResults(stores, items) {
  const baseStores = stores.length ? stores : [{ store_id: '', store_name: '全部门店' }];
  return baseStores.map((store) => {
    const sub = items.filter((item) => !item.store_id || item.store_id === store.store_id || item.store_name === store.store_name);
    const score = calculateHealthScore(sub);
    const risk = topIssues(sub, 1)[0];
    return {
      store_id: store.store_id || '',
      store_name: store.store_name || store.store_id || '全部门店',
      health_score: score.health_score,
      risk_level: score.risk_level,
      data_status: sub.some((item) => ['数据接入', '数据新鲜度'].includes(item.category) && item.status !== STATUS.ok) ? '需处理' : '正常',
      task_status: sub.some((item) => item.category === '任务闭环' && item.status !== STATUS.ok) ? '需处理' : '正常',
      ai_report_status: sub.some((item) => item.category === 'AI 可运行度' && item.status !== STATUS.ok) ? '受影响' : '可运行',
      attribution_status: sub.some((item) => item.category === '营销归因' && item.status !== STATUS.ok) ? '不完整' : '完整',
      main_risk: risk?.title || '暂无主要风险',
      abnormal_items: sub.filter((item) => item.status !== STATUS.ok).length,
    };
  });
}
