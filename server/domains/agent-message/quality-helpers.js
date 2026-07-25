/**
 * handleAgentMessage post-route 质量相关纯逻辑（从 agents.js 外提）。
 */

export const FACTUAL_DATA_UNAVAILABLE_MESSAGE =
  '抱歉，我当前无法从数据库中获取相关凭证/数据，请您登录系统手动核查。';

export const HARD_FACT_QUERY_PATTERNS =
  /(多少|几次|几天|几条|总数|占比|同比|环比|排名|top|倒数|趋势|营业额|营收|毛利|客诉|差评|桌访|达成率|人效|预测)/i;

export const FACT_TOPIC_PATTERNS =
  /(营业额|营收|毛利|桌访|差评|收档|开档|原料|报损|投诉|考核|绩效|评分|门店|菜品|产品|订单|充值)/i;

/** @returns {'none'|'soft'|'hard'} */
export function detectFactDemand(text) {
  const q = String(text || '').trim();
  if (!q) return 'none';
  if (FACT_TOPIC_PATTERNS.test(q) && HARD_FACT_QUERY_PATTERNS.test(q)) return 'hard';
  if (FACT_TOPIC_PATTERNS.test(q)) return 'soft';
  return 'none';
}

export function isDataBackedReply(d) {
  return !!(
    d &&
    (d.dataBacked === true ||
      d.deterministic === true ||
      d.grounded === true ||
      d.functionCalling === true ||
      !!d.source)
  );
}

export function computeSourceCoverage(agentData = {}) {
  const rows = Array.isArray(agentData?.sourceAuditRows) ? agentData.sourceAuditRows : [];
  if (rows.length > 0) {
    const ok = rows.filter((x) => x?.status === 'ok').length;
    return Number((ok / rows.length).toFixed(2));
  }
  if (agentData?.deterministic || agentData?.grounded || agentData?.source) return 1;
  return 0;
}

export function computeResponseConfidence(route, response, agentData = {}) {
  let score = 0.45;
  if (String(response || '').trim().length >= 18) score += 0.1;
  if (agentData?.deterministic) score += 0.25;
  if (agentData?.grounded) score += 0.2;
  if (agentData?.source) score += 0.1;
  if (agentData?.factualGuardrailBlocked) score -= 0.2;
  if (route === 'general') score -= 0.05;
  const coverage = computeSourceCoverage(agentData);
  score = score * 0.75 + coverage * 0.25;
  return Number(Math.max(0.05, Math.min(0.99, score)).toFixed(2));
}

export function buildEvidencePackage(agentData = {}, context = {}) {
  const sourceAuditRows = Array.isArray(agentData?.sourceAuditRows) ? agentData.sourceAuditRows : [];
  return {
    route: String(agentData?.route || context?.route || '').trim(),
    store: String(context?.store || agentData?.store || '').trim(),
    brand: String(context?.brand || agentData?.brand || '').trim(),
    source: String(agentData?.source || '').trim(),
    deterministic: !!agentData?.deterministic,
    grounded: !!agentData?.grounded,
    sourceCoverage: computeSourceCoverage(agentData),
    sourceAudit: sourceAuditRows.slice(0, 8).map((x) => ({
      key: x?.key,
      status: x?.status,
      count: x?.count,
      latest: x?.latest,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * hard 事实需求且无数据支撑 → 拦截为不可用文案。
 * @returns {{ response: string, agentData: object }}
 */
export function applyFactDemandGuardrail(opts, deps = {}) {
  const text = opts.text;
  const response = opts.response;
  const agentData = opts.agentData || {};
  const markQualityMetric = deps.markQualityMetric;
  const unavailableMessage = deps.unavailableMessage || FACTUAL_DATA_UNAVAILABLE_MESSAGE;

  const factDemand = detectFactDemand(text);
  if (factDemand === 'hard' && !isDataBackedReply(agentData)) {
    if (typeof markQualityMetric === 'function') markQualityMetric('factualBlocks', 1);
    return {
      response: unavailableMessage,
      agentData: { ...agentData, factualGuardrailBlocked: true, factDemand },
    };
  }
  return {
    response,
    agentData: { ...agentData, factDemand },
  };
}

/**
 * 附加 evidence / sourceCoverage / confidence。
 * @returns {{ response: string, agentData: object, evidence: object }}
 */
export function enrichAgentEvidenceMeta(opts) {
  const { response, route, store, brand } = opts;
  const agentData = opts.agentData || {};
  const evidence = buildEvidencePackage(agentData, { route, store, brand });
  return {
    response,
    evidence,
    agentData: {
      ...agentData,
      route,
      store,
      brand,
      evidence,
      sourceCoverage: computeSourceCoverage(agentData),
      confidence: computeResponseConfidence(route, response, agentData),
    },
  };
}

export function needsAutonomousDataTask(agentData) {
  return !!(
    agentData?.factualGuardrailBlocked ||
    agentData?.reason === 'insufficient_sources' ||
    agentData?.reason === 'insufficient_facts' ||
    agentData?.numericGroundingBlocked
  );
}
