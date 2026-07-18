/**
 * 试跑资格判断：规则表驱动的打分引擎，避免"标准变了要改代码重新发版"。
 * is_blocking=true 的规则未满足 => 一票否决(unfit)，其余规则只影响分数(conditional阈值)。
 */
const CONDITIONAL_THRESHOLD = 60;

function readField(lead, field) {
  return lead?.[field];
}

function evalCondition(lead, condition) {
  const { field, op, value } = condition || {};
  const actual = readField(lead, field);
  switch (op) {
    case 'eq': return actual === value;
    case 'gte': return Number(actual) >= Number(value);
    case 'not_empty': return actual != null && String(actual).trim() !== '';
    default: return false;
  }
}

export async function evaluateTrialEligibility(pool, lead) {
  const r = await pool.query(`SELECT rule_key, label, condition, weight, is_blocking FROM trial_eligibility_rules WHERE active=TRUE`);
  const rules = r.rows || [];
  let score = 0;
  const maxScore = rules.reduce((s, ru) => s + (ru.weight || 0), 0) || 1;
  const blockingReasons = [];
  const detail = [];
  for (const rule of rules) {
    const passed = evalCondition(lead, rule.condition);
    if (passed) score += rule.weight || 0;
    else if (rule.is_blocking) blockingReasons.push(rule.label);
    detail.push({ rule_key: rule.rule_key, label: rule.label, passed, weight: rule.weight, is_blocking: rule.is_blocking });
  }
  const pct = Math.round((score / maxScore) * 100);
  let verdict = 'eligible';
  if (blockingReasons.length > 0) verdict = 'unfit';
  else if (pct < CONDITIONAL_THRESHOLD) verdict = 'conditional';
  return { verdict, score: pct, blocking_reasons: blockingReasons, detail };
}
