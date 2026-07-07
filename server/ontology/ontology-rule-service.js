import { randomUUID } from 'node:crypto';

/**
 * Ontology Rule Engine Service
 * 支持规则配置化：store > tenant > system default 优先级
 */

// ─────────────────────────────────────────────
// 1. 规则加载
// ─────────────────────────────────────────────

export async function loadEffectiveRules(pool, { tenantId, storeId, ruleType, businessDomain, ruleId }) {
  const t = String(tenantId || '').trim() || 'default';
  const s = String(storeId || '').trim();
  const now = new Date().toISOString();

  // 1. 查询所有符合条件的规则（按优先级分组）
  const scopeConditions = [
    { clause: 'tenant_id IS NULL AND store_id IS NULL', params: [], label: 'system' },
  ];
  if (t) {
    scopeConditions.push({ clause: 'tenant_id = $1 AND store_id IS NULL', params: [t], label: 'tenant' });
  }
  if (s) {
    scopeConditions.push({ clause: 'tenant_id = $1 AND store_id = $2', params: [t, s], label: 'store' });
  }

  const typeClause = ruleType ? `AND rule_type = '${ruleType}'` : '';
  const domainClause = businessDomain ? `AND business_domain = '${businessDomain}'` : '';
  const ruleIdClause = ruleId ? `AND rule_id = '${ruleId}'` : '';

  const allRules = [];
  for (const scope of scopeConditions) {
    const sql = `
      SELECT * FROM ontology_rules
      WHERE ${scope.clause}
        AND is_active = true
        AND effective_from <= $${scope.params.length + 1}::timestamptz
        AND (effective_to IS NULL OR effective_to >= $${scope.params.length + 1}::timestamptz)
        ${typeClause} ${domainClause} ${ruleIdClause}
      ORDER BY rule_id, version DESC
    `;
    const params = [...scope.params, now];
    const queryFn = pool.__unwrappedQuery || pool.query;
    const r = await queryFn(sql, params).catch(() => ({ rows: [] }));
    for (const row of r.rows || []) {
      allRules.push({ ...row, _scope: scope.label });
    }
  }

  // 2. 按 rule_id 去重，优先级：store > tenant > system
  const priorityMap = { store: 3, tenant: 2, system: 1 };
  const byRuleId = new Map();
  for (const rule of allRules) {
    const existing = byRuleId.get(rule.rule_id);
    if (!existing || priorityMap[rule._scope] > priorityMap[existing._scope]) {
      byRuleId.set(rule.rule_id, rule);
    }
  }

  return [...byRuleId.values()];
}

// ─────────────────────────────────────────────
// 2. 规则评估
// ─────────────────────────────────────────────

function evaluateCondition(condition, inputContext) {
  if (!condition || typeof condition !== 'object') return { matched: false, reason: 'invalid_condition' };

  // 复合条件：all / any
  if (condition.all && Array.isArray(condition.all)) {
    const results = condition.all.map(c => evaluateCondition(c, inputContext));
    const matched = results.every(r => r.matched);
    return { matched, details: results, operator: 'all' };
  }
  if (condition.any && Array.isArray(condition.any)) {
    const results = condition.any.map(c => evaluateCondition(c, inputContext));
    const matched = results.some(r => r.matched);
    return { matched, details: results, operator: 'any' };
  }

  // 原子条件
  const { field, comparator, value } = condition;
  if (!field || !comparator) return { matched: false, reason: 'missing_field_or_comparator' };

  const inputValue = inputContext[field];
  const matched = compareValues(inputValue, comparator, value);
  return { matched, field, comparator, expected: value, actual: inputValue };
}

function compareValues(actual, comparator, expected) {
  // 处理 null/undefined
  if (actual === null || actual === undefined) {
    return comparator === 'not_exists' || comparator === 'is_null';
  }

  const numActual = Number(actual);
  const numExpected = Number(expected);
  const isNumActual = Number.isFinite(numActual);
  const isNumExpected = Number.isFinite(numExpected);

  switch (comparator) {
    case '>':
      return isNumActual && isNumExpected ? numActual > numExpected : false;
    case '>=':
      return isNumActual && isNumExpected ? numActual >= numExpected : false;
    case '<':
      return isNumActual && isNumExpected ? numActual < numExpected : false;
    case '<=':
      return isNumActual && isNumExpected ? numActual <= numExpected : false;
    case '=':
    case '==':
      return actual == expected;
    case '!=':
      return actual != expected;
    case 'between':
      if (Array.isArray(expected) && expected.length === 2 && isNumActual) {
        const [min, max] = expected.map(Number);
        return Number.isFinite(min) && Number.isFinite(max) && numActual >= min && numActual <= max;
      }
      return false;
    case 'in':
      return Array.isArray(expected) ? expected.includes(actual) : false;
    case 'exists':
      return actual !== null && actual !== undefined;
    case 'not_exists':
    case 'is_null':
      return actual === null || actual === undefined;
    default:
      return false;
  }
}

export async function evaluateRule(poolOrRule, ruleOrContext, inputContextMaybe) {
  // 兼容两种调用签名：
  // evaluateRule(pool, rule, inputContext) - 动态加载阈值
  // evaluateRule(rule, inputContext) - 直接使用 condition_json（向后兼容）
  let pool, rule, inputContext;
  if (inputContextMaybe !== undefined) {
    pool = poolOrRule;
    rule = ruleOrContext;
    inputContext = inputContextMaybe;
  } else {
    pool = null;
    rule = poolOrRule;
    inputContext = ruleOrContext;
  }
  
  const condition = rule.condition_json || {};
  
  // 如果有 pool，动态从 ontology_rule_thresholds 加载阈值替换 condition_json 中的值
  const enrichedCondition = pool ? await enrichConditionWithThresholds(pool, rule, condition) : condition;
  
  const evaluation = evaluateCondition(enrichedCondition, inputContext);
  return {
    ruleId: rule.rule_id,
    ruleVersion: rule.version,
    ruleName: rule.rule_name,
    businessDomain: rule.business_domain,
    matched: evaluation.matched,
    evaluation,
    confidenceScore: rule.confidence_base || 0.75,
    severity: rule.severity || 'P2',
    priority: rule.priority || 'P2',
  };
}

async function enrichConditionWithThresholds(pool, rule, condition) {
  if (!condition || typeof condition !== 'object') return condition;
  
  // 复合条件：递归处理
  if (condition.all && Array.isArray(condition.all)) {
    return {
      ...condition,
      all: await Promise.all(condition.all.map(c => enrichConditionWithThresholds(pool, rule, c)))
    };
  }
  if (condition.any && Array.isArray(condition.any)) {
    return {
      ...condition,
      any: await Promise.all(condition.any.map(c => enrichConditionWithThresholds(pool, rule, c)))
    };
  }
  
  // 原子条件：尝试从 thresholds 表加载阈值
  const { field, comparator } = condition;
  if (!field || !comparator) return condition;
  
  // 映射 field 到 threshold_key（支持 snake_case 和 camelCase）
  const thresholdKeyMap = {
    last_visit_days: 'days_min',
    lastVisitDays: 'days_min',
    first_visit_days: 'days_min',
    firstVisitDays: 'days_min',
    revenue_change_rate: 'decline_threshold',
    revenueChangeRate: 'decline_threshold',
    repeat_rate: 'rate_threshold',
    repeatRate: 'rate_threshold',
    marketing_conversion_rate: 'conversion_threshold',
    marketingConversionRate: 'conversion_threshold',
    overdue_task_count: 'overdue_count',
    overdueTaskCount: 'overdue_count',
    overdue_rate: 'overdue_rate',
    overdueRate: 'overdue_rate',
  };
  
  const thresholdKey = thresholdKeyMap[field];
  if (!thresholdKey) return condition;
  
  const tenantId = rule.tenant_id;
  const storeId = rule.store_id;
  const ruleId = rule.rule_id;
  
  // 尝试加载阈值
  const threshold = await getRuleThreshold(pool, { tenantId, storeId, ruleId, thresholdKey }).catch(() => null);
  if (!threshold || threshold.scope === 'fallback') return condition;
  
  // 根据 comparator 类型替换 value
  let newValue = condition.value;
  if (comparator === 'between') {
    // 对于 between，需要加载 min 和 max 两个阈值
    const minKey = thresholdKey.replace('_max', '_min').replace(/_min$/, '_min');
    const maxKey = thresholdKey.replace('_min', '_max').replace(/_max$/, '_max');
    
    const minThreshold = await getRuleThreshold(pool, { tenantId, storeId, ruleId, thresholdKey: minKey }).catch(() => null);
    const maxThreshold = await getRuleThreshold(pool, { tenantId, storeId, ruleId, thresholdKey: maxKey }).catch(() => null);
    
    if (minThreshold?.scope !== 'fallback' || maxThreshold?.scope !== 'fallback') {
      const minVal = minThreshold?.scope !== 'fallback' ? minThreshold.value : (Array.isArray(condition.value) ? condition.value[0] : 0);
      const maxVal = maxThreshold?.scope !== 'fallback' ? maxThreshold.value : (Array.isArray(condition.value) ? condition.value[1] : 0);
      newValue = [minVal, maxVal];
    }
  } else if (['>', '>=', '<', '<=', '=', '!='].includes(comparator)) {
    newValue = threshold.value;
  }
  
  return { ...condition, value: newValue };
}

export async function evaluateRules(pool, { tenantId, storeId, businessDomain, inputContext }) {
  const rules = await loadEffectiveRules(pool, { tenantId, storeId, businessDomain });
  const matched = [];
  const unmatched = [];

  for (const rule of rules) {
    const result = await evaluateRule(pool, rule, inputContext);
    if (result.matched) {
      matched.push(result);
    } else {
      unmatched.push(result);
    }
  }

  return {
    matchedRules: matched,
    unmatchedRules: unmatched,
    evaluationSummary: {
      totalRules: rules.length,
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      topSeverity: matched.length > 0
        ? matched.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0].severity
        : null,
    },
  };
}

function severityRank(severity) {
  const map = { P1: 3, P2: 2, P3: 1 };
  return map[severity] || 0;
}

// ─────────────────────────────────────────────
// 3. 规则命中记录
// ─────────────────────────────────────────────

export async function recordRuleHit(pool, {
  tenantId,
  storeId,
  rule,
  inputContext,
  output,
  generatedIssueId,
  generatedOpportunityId,
  generatedTaskId,
}) {
  const t = String(tenantId || 'default').trim();
  const s = String(storeId || '').trim();
  const ruleId = rule?.rule_id || '';
  const ruleVersion = rule?.version || 1;
  const ruleType = rule?.rule_type || 'diagnosis';
  const entityType = output?.entityType || 'store';
  const entityId = output?.entityId || s;
  const confidenceScore = output?.confidenceScore || rule?.confidence_base || 0.75;
  const severity = output?.severity || rule?.severity || 'P2';
  const bossLanguage = output?.bossLanguage || '';

  const r = await pool.query(
    `INSERT INTO ontology_rule_hits (
      tenant_id, store_id, rule_id, rule_version, rule_type,
      entity_type, entity_id, input_snapshot_json, matched_conditions_json,
      generated_issue_id, generated_opportunity_id, generated_task_id,
      confidence_score, severity, boss_language_output, hit_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,now())
    RETURNING *`,
    [
      t, s || null, ruleId, ruleVersion, ruleType,
      entityType, entityId,
      JSON.stringify(inputContext || {}),
      JSON.stringify(output?.evaluation?.evaluation || {}),
      generatedIssueId || null,
      generatedOpportunityId || null,
      generatedTaskId || null,
      confidenceScore,
      severity,
      bossLanguage,
    ]
  );
  return r.rows?.[0] || null;
}

// ─────────────────────────────────────────────
// 4. Boss 语言渲染
// ─────────────────────────────────────────────

export function renderBossLanguage(rule, variables = {}) {
  const template = rule?.boss_language_template || '';
  if (!template) return '系统发现一条经营规则命中，建议跟进处理。';

  let result = template;
  for (const [key, value] of Object.entries(variables || {})) {
    const placeholder = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(placeholder, String(value ?? '-'));
  }

  // 清理未替换的占位符
  result = result.replace(/\{[^}]+\}/g, '-');

  return result;
}

// ─────────────────────────────────────────────
// 5. 阈值获取
// ─────────────────────────────────────────────

export async function getRuleThreshold(pool, { tenantId, storeId, ruleId, thresholdKey, defaultValue }) {
  const t = String(tenantId || '').trim() || 'default';
  const s = String(storeId || '').trim();

  // 优先级：store > tenant > system
  const scopes = [
    { clause: 'tenant_id = $1 AND store_id = $2', params: [t, s], label: 'store' },
    { clause: 'tenant_id = $1 AND store_id IS NULL', params: [t], label: 'tenant' },
    { clause: 'tenant_id IS NULL AND store_id IS NULL', params: [], label: 'system' },
  ];

  for (const scope of scopes) {
    const sql = `
      SELECT threshold_value, threshold_unit, comparator
      FROM ontology_rule_thresholds
      WHERE ${scope.clause}
        AND rule_id = $${scope.params.length + 1}
        AND threshold_key = $${scope.params.length + 2}
        AND is_active = true
      LIMIT 1
    `;
    const params = [...scope.params, ruleId, thresholdKey];
    // Use unwrapped query to bypass tenant context wrapping
    const queryFn = pool.__unwrappedQuery || pool.query;
    const r = await queryFn(sql, params).catch(() => ({ rows: [] }));
    if (r.rows?.[0]) {
      return {
        value: Number(r.rows[0].threshold_value),
        unit: r.rows[0].threshold_unit,
        comparator: r.rows[0].comparator,
        scope: scope.label,
      };
    }
  }

  return { value: defaultValue, unit: '', comparator: '=', scope: 'fallback' };
}

// ─────────────────────────────────────────────
// 6. 规则 CRUD 辅助
// ─────────────────────────────────────────────

export async function listRules(pool, { tenantId, storeId, ruleType, businessDomain, isActive, limit = 100, offset = 0 }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (tenantId !== undefined) {
    conditions.push(`(tenant_id = $${idx} OR tenant_id IS NULL)`);
    params.push(String(tenantId || ''));
    idx++;
  }
  if (storeId !== undefined) {
    conditions.push(`(store_id = $${idx} OR store_id IS NULL)`);
    params.push(String(storeId || ''));
    idx++;
  }
  if (ruleType) {
    conditions.push(`rule_type = $${idx}`);
    params.push(ruleType);
    idx++;
  }
  if (businessDomain) {
    conditions.push(`business_domain = $${idx}`);
    params.push(businessDomain);
    idx++;
  }
  if (isActive !== undefined) {
    conditions.push(`is_active = $${idx}`);
    params.push(isActive);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT * FROM ontology_rules
    ${where}
    ORDER BY rule_id, version DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `;
  params.push(limit, offset);

  const r = await pool.query(sql, params).catch(() => ({ rows: [] }));
  return r.rows || [];
}

export async function getRuleById(pool, ruleId, { tenantId, storeId } = {}) {
  const t = String(tenantId || '').trim() || 'default';
  const s = String(storeId || '').trim();

  // 优先返回当前生效的最高优先级版本
  const scopes = [
    { clause: 'tenant_id = $1 AND store_id = $2', params: [t, s] },
    { clause: 'tenant_id = $1 AND store_id IS NULL', params: [t] },
    { clause: 'tenant_id IS NULL AND store_id IS NULL', params: [] },
  ];

  for (const scope of scopes) {
    const sql = `
      SELECT * FROM ontology_rules
      WHERE ${scope.clause}
        AND rule_id = $${scope.params.length + 1}
        AND is_active = true
        AND effective_from <= now()
        AND (effective_to IS NULL OR effective_to >= now())
      ORDER BY version DESC
      LIMIT 1
    `;
    const params = [...scope.params, ruleId];
    const r = await pool.query(sql, params).catch(() => ({ rows: [] }));
    if (r.rows?.[0]) return r.rows[0];
  }

  return null;
}

export async function createRule(pool, ruleData) {
  const {
    ruleId, tenantId, storeId, ruleType, ruleName, businessDomain,
    targetMetric, conditionJson, actionJson, bossLanguageTemplate,
    severity, priority, confidenceBase, version, effectiveFrom, createdBy,
  } = ruleData;

  const r = await pool.query(
    `INSERT INTO ontology_rules (
      rule_id, tenant_id, store_id, rule_type, rule_name, business_domain,
      target_metric, condition_json, action_json, boss_language_template,
      severity, priority, confidence_base, version, effective_from, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (rule_id, COALESCE(tenant_id, ''), COALESCE(store_id, ''), version) DO UPDATE SET
      rule_name = EXCLUDED.rule_name,
      business_domain = EXCLUDED.business_domain,
      target_metric = EXCLUDED.target_metric,
      condition_json = EXCLUDED.condition_json,
      action_json = EXCLUDED.action_json,
      boss_language_template = EXCLUDED.boss_language_template,
      severity = EXCLUDED.severity,
      priority = EXCLUDED.priority,
      confidence_base = EXCLUDED.confidence_base,
      is_active = EXCLUDED.is_active,
      updated_at = now()
    RETURNING *`,
    [
      ruleId, tenantId || null, storeId || null, ruleType || 'diagnosis',
      ruleName, businessDomain, targetMetric || null,
      JSON.stringify(conditionJson || {}), JSON.stringify(actionJson || {}),
      bossLanguageTemplate || null,
      severity || 'P2', priority || 'P2', confidenceBase || 0.75,
      version || 1, effectiveFrom || new Date().toISOString(), createdBy || 'system',
    ]
  );
  return r.rows?.[0] || null;
}

export async function disableRule(pool, ruleId, { tenantId, storeId } = {}) {
  const t = tenantId || null;
  const s = storeId || null;
  const r = await pool.query(
    `UPDATE ontology_rules
     SET is_active = false, updated_at = now()
     WHERE rule_id = $1
       AND COALESCE(tenant_id, '') = COALESCE($2, '')
       AND COALESCE(store_id, '') = COALESCE($3, '')
     RETURNING *`,
    [ruleId, t, s]
  );
  return r.rows?.[0] || null;
}

export async function enableRule(pool, ruleId, { tenantId, storeId } = {}) {
  const t = tenantId || null;
  const s = storeId || null;
  const r = await pool.query(
    `UPDATE ontology_rules
     SET is_active = true, updated_at = now()
     WHERE rule_id = $1
       AND COALESCE(tenant_id, '') = COALESCE($2, '')
       AND COALESCE(store_id, '') = COALESCE($3, '')
     RETURNING *`,
    [ruleId, t, s]
  );
  return r.rows?.[0] || null;
}

export async function listRuleHits(pool, { tenantId, storeId, ruleId, startDate, endDate, limit = 100, offset = 0 }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  conditions.push(`tenant_id = $${idx}`);
  params.push(String(tenantId || 'default'));
  idx++;

  if (storeId) {
    conditions.push(`store_id = $${idx}`);
    params.push(storeId);
    idx++;
  }
  if (ruleId) {
    conditions.push(`rule_id = $${idx}`);
    params.push(ruleId);
    idx++;
  }
  if (startDate) {
    conditions.push(`hit_at >= $${idx}`);
    params.push(startDate);
    idx++;
  }
  if (endDate) {
    conditions.push(`hit_at <= $${idx}`);
    params.push(endDate);
    idx++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const sql = `
    SELECT * FROM ontology_rule_hits
    ${where}
    ORDER BY hit_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}
  `;
  params.push(limit, offset);

  const r = await pool.query(sql, params).catch(() => ({ rows: [] }));
  return r.rows || [];
}

// ─────────────────────────────────────────────
// 7. 规则来源说明（用于 closed-loop report）
// ─────────────────────────────────────────────

export function getRuleSourceNote(rule) {
  if (!rule) return '使用系统默认经营规则判断';
  if (rule.store_id) return '使用本门店专属经营规则判断';
  if (rule.tenant_id) return '使用本品牌经营规则判断';
  return '使用系统默认经营规则判断';
}

// Alias for backward compatibility with diagnosis-tree-service.js
export const confidenceNoteForRule = getRuleSourceNote;

// ─────────────────────────────────────────────
// 8. 诊断辅助：从配置规则生成 issue / opportunity 数据
// ─────────────────────────────────────────────

export function buildIssueFromRuleHit(rule, inputContext, issueId) {
  const action = rule.action_json || {};
  return {
    issue_id: issueId,
    tenant_id: inputContext.tenantId || 'default',
    store_id: inputContext.storeId || '',
    issue_type: action.issue_type || rule.rule_id,
    issue_title: action.issue_title || rule.rule_name,
    issue_description: action.issue_description || `规则 ${rule.rule_name} 命中`,
    severity: rule.severity || 'P2',
    confidence_score: rule.confidence_base || 0.75,
    evidence_json: inputContext,
    root_cause_candidates_json: action.root_causes || [],
    impact_amount_estimate: action.impact_estimate || 0,
    status: 'open',
    first_detected_at: new Date().toISOString(),
    last_detected_at: new Date().toISOString(),
  };
}

export function buildOpportunityFromRuleHit(rule, inputContext, opportunityId, issueId) {
  const action = rule.action_json || {};
  const estimatedRevenue = inputContext.revenueGap || action.impact_estimate || 0;
  const estimatedCost = action.estimated_cost || (rule.business_domain === 'customer_growth' ? 300 : 0);

  return {
    opportunity_id: opportunityId,
    tenant_id: inputContext.tenantId || 'default',
    store_id: inputContext.storeId || '',
    issue_id: issueId,
    opportunity_type: action.generate_opportunity || rule.rule_id,
    title: action.opportunity_title || rule.rule_name,
    description: action.opportunity_description || `规则 ${rule.rule_name} 命中，建议执行 ${action.recommended_action || '跟进动作'}`,
    target_entity_type: action.target_entity_type || 'customer_segment',
    target_entity_ids_json: [],
    estimated_revenue_uplift: estimatedRevenue,
    estimated_cost: estimatedCost,
    expected_roi: estimatedCost > 0 ? Number((estimatedRevenue / estimatedCost).toFixed(2)) : null,
    priority: rule.priority || 'P2',
    evidence_json: inputContext,
    recommended_actions_json: (action.recommended_actions || [action.recommended_action || '执行跟进动作']).map((name, idx) => ({ actionName: name, step: idx + 1 })),
    status: 'open',
  };
}

// ─────────────────────────────────────────────
// 9. Schema 初始化
// ─────────────────────────────────────────────

export async function ensureOntologyRuleConfig(pool) {
  if (!pool?.query) return { ok: false, skipped: true };
  const statements = [
    `CREATE TABLE IF NOT EXISTS ontology_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id varchar(120) NOT NULL,
      tenant_id varchar(80),
      store_id varchar(120),
      rule_type varchar(60) NOT NULL DEFAULT 'diagnosis',
      rule_name varchar(200) NOT NULL,
      business_domain varchar(80) NOT NULL,
      target_metric varchar(120),
      condition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      action_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      boss_language_template text,
      severity varchar(20) DEFAULT 'P2',
      priority varchar(20) DEFAULT 'P2',
      confidence_base numeric DEFAULT 0.75,
      version integer NOT NULL DEFAULT 1,
      is_active boolean NOT NULL DEFAULT true,
      effective_from timestamptz NOT NULL DEFAULT now(),
      effective_to timestamptz,
      created_by varchar(120) DEFAULT 'system',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ontology_rule_thresholds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rule_id varchar(120) NOT NULL,
      tenant_id varchar(80),
      store_id varchar(120),
      threshold_key varchar(120) NOT NULL,
      threshold_value numeric NOT NULL,
      threshold_unit varchar(40),
      comparator varchar(20),
      description text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ontology_rule_hits (
      id bigserial PRIMARY KEY,
      tenant_id varchar(80) NOT NULL DEFAULT 'default',
      store_id varchar(120),
      rule_id varchar(120) NOT NULL,
      rule_version integer,
      rule_type varchar(60),
      entity_type varchar(80),
      entity_id varchar(200),
      input_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      matched_conditions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
      generated_issue_id varchar(200),
      generated_opportunity_id varchar(200),
      generated_task_id varchar(200),
      confidence_score numeric,
      severity varchar(20),
      boss_language_output text,
      hit_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS ontology_rule_sets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id varchar(80),
      store_id varchar(120),
      rule_set_name varchar(200) NOT NULL,
      business_type varchar(80),
      description text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
  ];
  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS ontology_rules_scope_version_idx ON ontology_rules (rule_id, COALESCE(tenant_id, ''), COALESCE(store_id, ''), version)`,
    `CREATE INDEX IF NOT EXISTS idx_ontology_rules_lookup ON ontology_rules (rule_id, tenant_id, store_id, is_active, effective_from, effective_to)`,
    `CREATE INDEX IF NOT EXISTS idx_ontology_rules_domain ON ontology_rules (business_domain, rule_type, is_active)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ontology_rule_thresholds_scope_idx ON ontology_rule_thresholds (rule_id, threshold_key, COALESCE(tenant_id, ''), COALESCE(store_id, ''))`,
    `CREATE INDEX IF NOT EXISTS idx_ontology_rule_thresholds_lookup ON ontology_rule_thresholds (rule_id, threshold_key, tenant_id, store_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_ontology_rule_hits_tenant_time ON ontology_rule_hits (tenant_id, hit_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ontology_rule_hits_rule ON ontology_rule_hits (rule_id, tenant_id, store_id, hit_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ontology_rule_sets_scope ON ontology_rule_sets (tenant_id, store_id, is_active)`,
  ];
  for (const sql of statements) await pool.query(sql).catch(() => {});
  for (const sql of indexes) await pool.query(sql).catch(() => {});
  return { ok: true };
}
