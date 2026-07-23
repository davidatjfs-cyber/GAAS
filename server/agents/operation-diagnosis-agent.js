import { callOntologyForAgent } from './tools/ontology-tool-client.js';


const LOG_PREFIX = '[OntologyAgent]';

const BUSINESS_DOMAINS = {
  revenue_decline: 'operation_improvement',
  repeat_decline: 'customer_growth',
  new_customer_no_second_visit: 'customer_growth',
  customer_asset_risk: 'customer_growth',
  staff_execution_risk: 'talent_development',
  marketing_ineffective: 'customer_growth',
};

const DEFAULT_DOMAIN = 'operation_improvement';

const OWNER_ROLE_BY_ISSUE = {
  revenue_decline: '店长',
  repeat_decline: '店长',
  new_customer_no_second_visit: '店长',
  customer_asset_risk: '营销负责人',
  staff_execution_risk: '督导',
  marketing_ineffective: '营销负责人',
};

const OWNER_ROLE_BY_OPP = {
  dormant_customer_reactivation: '营销负责人',
  vip_retention: '营销负责人',
  new_customer_second_visit: '店长',
  stored_value_customer_activation: '店长',
  low_repeat_dish_optimization: '厨师长',
  lunch_revenue_recovery: '店长',
  negative_review_recovery: '店长',
  staff_execution_improvement: '督导',
};

function log(message, extra = {}) {
  const extraStr = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
  console.log(`${LOG_PREFIX} ${message}${extraStr}`);
}

function severityPriority(severity) {
  const s = String(severity || '').toUpperCase();
  if (s === 'P1') return 1;
  if (s === 'P2') return 2;
  return 3;
}

function sortIssues(issues) {
  return [...issues].sort((a, b) => severityPriority(a.severity) - severityPriority(b.severity));
}

function mapIssueToTopIssue(issue, storeId, storeName) {
  const evidence = issue.evidence_json || {};
  const reasonParts = [];
  if (evidence.changeRate !== undefined && evidence.changeRate !== null) {
    reasonParts.push(`环比变化 ${Number(evidence.changeRate).toFixed(1)}%`);
  }
  if (evidence.currentRevenue !== undefined && evidence.previousRevenue !== undefined) {
    reasonParts.push(`本期营业额 ${Number(evidence.currentRevenue).toFixed(0)} 元，上期 ${Number(evidence.previousRevenue).toFixed(0)} 元`);
  }
  if (evidence.repeatRate !== undefined && evidence.repeatRate !== null) {
    reasonParts.push(`复购率 ${(Number(evidence.repeatRate) * 100).toFixed(1)}%`);
  }
  if (evidence.noSecondVisit !== undefined && evidence.noSecondVisit !== null) {
    reasonParts.push(`${Number(evidence.noSecondVisit)} 位新客未二次回店`);
  }
  if (evidence.riskCustomers !== undefined && evidence.riskCustomers !== null) {
    reasonParts.push(`${Number(evidence.riskCustomers)} 位高风险客户`);
  }
  if (evidence.dormantCustomerCount !== undefined && evidence.dormantCustomerCount !== null) {
    reasonParts.push(`${Number(evidence.dormantCustomerCount)} 位沉睡客户`);
  }
  if (evidence.touched !== undefined && evidence.conversionRate !== undefined) {
    reasonParts.push(`触达 ${Number(evidence.touched)} 人，转化率 ${(Number(evidence.conversionRate) * 100).toFixed(1)}%`);
  }
  if (evidence.lowCount !== undefined && evidence.lowCount !== null) {
    reasonParts.push(`${Number(evidence.lowCount)} 位员工执行评分偏低`);
  }
  if (!reasonParts.length) {
    reasonParts.push(issue.issue_description || '系统识别到该经营问题');
  }

  const domain = BUSINESS_DOMAINS[issue.issue_type] || DEFAULT_DOMAIN;
  const ownerRole = OWNER_ROLE_BY_ISSUE[issue.issue_type] || '店长';

  return {
    id: issue.issue_id,
    name: issue.issue_title || issue.issue_type,
    domain,
    priority: issue.severity || 'P3',
    reason: reasonParts.join('；'),
    storeId: issue.store_id || storeId,
    storeName: storeName || issue.store_id || storeId,
    ownerRole,
    evidence: [
      { type: 'issue', label: '问题类型', value: issue.issue_type, source: 'diagnosis-tree-service' },
      { type: 'issue', label: '严重级别', value: issue.severity || 'P3', source: 'diagnosis-tree-service' },
      { type: 'issue', label: '置信度', value: Number(issue.confidence_score || 0).toFixed(2), source: 'ontology-rule-service' },
      ...reasonParts.map((reason, idx) => ({ type: 'metric', label: idx === 0 ? '核心证据' : '辅助证据', value: reason, source: 'ontology-data' })),
    ],
  };
}

function stripTrailingPeriod(text) {
  return String(text || '').replace(/[。.]+$/, '');
}

function mapOpportunityToAction(opp, issueMap) {
  const actions = Array.isArray(opp.recommended_actions_json) ? opp.recommended_actions_json : [];
  const steps = actions.map(a => a.actionName || a).filter(Boolean);
  const ownerRole = OWNER_ROLE_BY_OPP[opp.opportunity_type] || opp.recommended_actions_json?.[0]?.ownerRole || '店长';
  const deadlineDays = actions[0]?.deadlineDays || 3;
  const trackingMetrics = actions[0]?.trackingMetrics || ['任务完成率', '追踪营业额'];
  // opp.description(兜底来源之一)本身已经以句号结尾，下游模板会再拼一个"预期结果：{expectedResult}。"，
  // 不去掉这里的尾部句号就会变成"。。"——统一在这里清一次，不用到处补丁。
  const expectedResult = stripTrailingPeriod(actions[0]?.expectedResult || opp.expectedResult || opp.description);

  return {
    id: opp.opportunity_id,
    name: opp.title || opp.opportunity_type,
    priority: opp.priority || 'P2',
    ownerRole,
    deadlineDays: Number(deadlineDays),
    steps,
    trackingMetrics,
    expectedResult,
  };
}

function mapOpportunityToTaskDraft(opp) {
  const actions = Array.isArray(opp.recommended_actions_json) ? opp.recommended_actions_json : [];
  const ownerRole = OWNER_ROLE_BY_OPP[opp.opportunity_type] || actions[0]?.ownerRole || '店长';
  const deadlineDays = actions[0]?.deadlineDays || 3;
  const trackingMetrics = actions[0]?.trackingMetrics || ['任务完成率', '追踪营业额'];
  const expectedResult = stripTrailingPeriod(actions[0]?.expectedResult || opp.expectedResult || opp.description);
  const domain = BUSINESS_DOMAINS[opp.issue_id ? 'from_issue' : 'operation_improvement'];

  return {
    sourceOpportunityId: opp.opportunity_id,
    title: opp.title || '经营增长动作',
    ownerRole,
    deadlineDays: Number(deadlineDays),
    trackingMetrics,
    expectedResult,
    sourceDomain: domain,
  };
}

function buildEvidence(ontologyData, topIssues) {
  const evidence = [];
  if (ontologyData.closedLoopReport?.attributionSummary?.attributedRevenue > 0) {
    evidence.push({
      type: 'attribution',
      label: '已归因营业额',
      value: `${Number(ontologyData.closedLoopReport.attributionSummary.attributedRevenue).toFixed(0)} 元`,
      source: 'closed-loop-report',
    });
  }
  if (ontologyData.closedLoopReport?.tasks?.length > 0) {
    const completed = ontologyData.closedLoopReport.tasks.filter(t => ['done', 'closed', 'completed'].includes(String(t.status))).length;
    evidence.push({
      type: 'task',
      label: '已创建任务',
      value: `${ontologyData.closedLoopReport.tasks.length} 个（完成 ${completed} 个）`,
      source: 'closed-loop-report',
    });
  }
  for (const issue of topIssues) {
    for (const ev of issue.evidence) {
      evidence.push({
        type: ev.type,
        label: ev.label,
        value: ev.value,
        source: ev.source,
      });
    }
  }
  return evidence;
}

function buildInsufficientDataResponse(ontologyData, params) {
  log('insufficient ontology data', params);
  return {
    bossSummary: '当前数据不足，无法形成可靠经营诊断。',
    topIssues: [],
    recommendedActions: [],
    taskDrafts: [],
    evidence: [],
    nextStep: '请先确认营业数据、客户数据、任务数据或营销数据是否已接入。',
    naturalLanguageAnswer: '当前数据不足，无法形成可靠经营诊断。请先确认营业数据、客户数据、任务数据或营销数据是否已接入，然后再让我重新诊断。',
    ontologyMeta: {
      ontologyAvailable: ontologyData.ontologyAvailable,
      calledApis: ontologyData.calledApis || [],
      issuesCount: 0,
      opportunitiesCount: 0,
      generatedAt: new Date().toISOString(),
    },
  };
}

function buildBossSummary(ontologyData, topIssues) {
  if (ontologyData.closedLoopReport?.boss_summary) {
    return ontologyData.closedLoopReport.boss_summary;
  }
  if (topIssues.length === 0) {
    return '当前数据不足，无法形成可靠经营诊断。';
  }
  const p1 = topIssues.find(i => i.priority === 'P1');
  if (p1) {
    return `系统发现 ${p1.name} 需要优先处理，建议由 ${p1.ownerRole} 今天跟进。`;
  }
  return `系统发现 ${topIssues.length} 个经营问题，建议按优先级逐步处理。`;
}

function buildNaturalLanguageAnswerFallback(ontologyData, topIssues, recommendedActions, taskDrafts) {
  if (!topIssues.length) {
    return buildInsufficientDataResponse(ontologyData, {}).naturalLanguageAnswer;
  }
  const lines = [];
  lines.push(buildBossSummary(ontologyData, topIssues));
  lines.push('');
  lines.push('最近需要重点关注的问题：');
  topIssues.forEach((issue, idx) => {
    lines.push(`${idx + 1}. ${issue.name}（${issue.priority}）：${issue.reason}，建议由 ${issue.ownerRole} 负责。`);
  });
  if (recommendedActions.length) {
    lines.push('');
    lines.push('建议动作：');
    recommendedActions.forEach((action, idx) => {
      lines.push(`${idx + 1}. ${action.name}，由 ${action.ownerRole} 在 ${action.deadlineDays} 天内完成，预期结果：${action.expectedResult}。`);
    });
  }
  if (taskDrafts.length) {
    lines.push('');
    lines.push('已生成任务草稿，可以点击“生成正式任务”推送到执行闭环。');
  }
  lines.push('');
  lines.push('下一步：建议先确认数据准确性，再按优先级安排负责人执行，系统会持续追踪结果。');
  return lines.join('\n');
}

function buildPromptExpression(ontologyData, topIssues, recommendedActions, taskDrafts) {
  const prompt = `你是餐厅经营诊断 Agent。
你不能凭空判断经营问题。
你必须优先基于下面的 ontologyData 回答。
如果 ontologyData 为空或证据不足，必须明确说明“当前数据不足，无法形成可靠诊断”。
你的任务不是重新发明经营判断，而是把结构化诊断结果翻译成老板能听懂、店长能执行的语言。
输出必须包含老板一句话结论、前三个问题、建议动作、任务草稿、数据证据、下一步建议。
不要使用 ontology、语义层、E2E、规则引擎等技术词给老板解释。
语言要像餐饮经营顾问，不要像技术文档。

ontologyData = ${JSON.stringify({
  bossSummary: buildBossSummary(ontologyData, topIssues),
  topIssues,
  recommendedActions,
  taskDrafts,
  evidence: buildEvidence(ontologyData, topIssues),
}, null, 2)}

请用中文输出一段自然语言回答，直接给餐厅老板看。控制在 300 字以内。`;
  return prompt;
}

async function buildNaturalLanguageAnswer(ontologyData, topIssues, recommendedActions, taskDrafts, callLLM) {
  if (!topIssues.length) {
    return buildNaturalLanguageAnswerFallback(ontologyData, topIssues, recommendedActions, taskDrafts);
  }
  if (!callLLM) {
    return buildNaturalLanguageAnswerFallback(ontologyData, topIssues, recommendedActions, taskDrafts);
  }
  try {
    const prompt = buildPromptExpression(ontologyData, topIssues, recommendedActions, taskDrafts);
    const llmResult = await callLLM([{ role: 'user', content: prompt }], { purpose: 'reasoning', max_tokens: 800, temperature: 0.3 });
    if (llmResult?.ok && llmResult.content) {
      return String(llmResult.content).trim();
    }
    return buildNaturalLanguageAnswerFallback(ontologyData, topIssues, recommendedActions, taskDrafts);
  } catch (e) {
    log('LLM expression failed, fallback to template', { error: e?.message || e });
    return buildNaturalLanguageAnswerFallback(ontologyData, topIssues, recommendedActions, taskDrafts);
  }
}

function buildNextStep(topIssues, recommendedActions) {
  if (!topIssues.length) return '请先确认营业数据、客户数据、任务数据或营销数据是否已接入。';
  const p1 = topIssues.find(i => i.priority === 'P1');
  if (p1) return `优先处理 ${p1.name}，由 ${p1.ownerRole} 今天跟进；然后按顺序推进其他问题。`;
  if (recommendedActions.length) return `按优先级执行建议动作，系统会持续追踪结果。`;
  return '继续观察经营数据，确认问题是否改善。';
}

export async function runOperationDiagnosisAgent(pool, options = {}, callLLM = null) {
  const params = {
    tenantId: String(options.tenantId || options.tenant_id || 'default').trim() || 'default',
    storeId: String(options.storeId || options.store_id || '').trim(),
    storeName: String(options.storeName || options.store_name || '').trim(),
    date: options.date || new Date().toISOString().slice(0, 10),
    period: options.period || '30d',
  };

  const ontologyClient = options.ontologyClient || ((p, opts) => callOntologyForAgent(p, opts));

  log('operation diagnosis started', { tenant: params.tenantId, store: params.storeId, date: params.date });

  let ontologyData;
  try {
    ontologyData = await ontologyClient(pool, params);
  } catch (e) {
    log('ontology client failed', { error: e?.message || e, tenant: params.tenantId, store: params.storeId });
    ontologyData = {
      diagnosis: null,
      issues: [],
      opportunities: [],
      closedLoopReport: null,
      taskDrafts: [],
      evidence: [],
      raw: {},
      ontologyAvailable: false,
      calledApis: [],
      errors: [{ api: 'ontologyClient', error: String(e?.message || e) }],
      issuesCount: 0,
      opportunitiesCount: 0,
      generatedAt: new Date().toISOString(),
    };
  }

  const issues = sortIssues(ontologyData.issues || []);
  const opportunities = ontologyData.opportunities || [];

  if (!issues.length && !opportunities.length) {
    return buildInsufficientDataResponse(ontologyData, params);
  }

  const topIssues = issues.slice(0, 3).map(issue => mapIssueToTopIssue(issue, params.storeId, params.storeName));
  const issueMap = new Map(issues.map(i => [i.issue_id, i]));

  const relatedOpportunities = opportunities.filter(opp => topIssues.some(i => i.id === opp.issue_id)).slice(0, 5);
  const recommendedActions = relatedOpportunities.map(opp => mapOpportunityToAction(opp, issueMap)).slice(0, 5);
  const taskDrafts = relatedOpportunities.map(opp => mapOpportunityToTaskDraft(opp)).slice(0, 5);

  const evidence = buildEvidence(ontologyData, topIssues);
  const bossSummary = buildBossSummary(ontologyData, topIssues);
  const naturalLanguageAnswer = await buildNaturalLanguageAnswer(ontologyData, topIssues, recommendedActions, taskDrafts, callLLM);
  const nextStep = buildNextStep(topIssues, recommendedActions);

  log('operation diagnosis completed', {
    tenant: params.tenantId,
    store: params.storeId,
    issues: issues.length,
    opportunities: opportunities.length,
    topIssues: topIssues.map(i => `${i.priority}:${i.name}`).join(','),
    taskDrafts: taskDrafts.length,
  });

  return {
    bossSummary,
    topIssues,
    recommendedActions,
    taskDrafts,
    evidence,
    nextStep,
    naturalLanguageAnswer,
    ontologyMeta: {
      ontologyAvailable: ontologyData.ontologyAvailable,
      calledApis: ontologyData.calledApis || [],
      issuesCount: issues.length,
      opportunitiesCount: opportunities.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function generateOperationDiagnosisTasks(pool, options = {}) {
  const opportunityId = String(options.opportunityId || options.opportunity_id || '').trim();
  if (!opportunityId) {
    return { ok: false, error: 'opportunity_id_required' };
  }
  const tenantId = String(options.tenantId || options.tenant_id || 'default').trim() || 'default';
  const storeId = String(options.storeId || options.store_id || '').trim();
  const ownerUserId = String(options.ownerUserId || options.owner_user_id || '').trim();
  const { generateTasksForOpportunity } = await import('../ontology/action-plan-service.js');
  const result = await generateTasksForOpportunity(pool, opportunityId, {
    tenantId,
    storeId,
    ownerUserId,
    generatedByAgent: 'operation_diagnosis_agent',
  });
  log('generated task from opportunity', { tenantId, storeId, opportunityId, taskId: result.tasks?.[0]?.task_id });
  return result;
}
