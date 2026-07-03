/**
 * Plan Grounding Check — 程序化（非LLM）数字校验
 *
 * 背景：action_plans 里 4/8 条被合规LLM拒绝，原因都是同一种模式——
 * 生成计划的LLM在rootCauses/summary里编造了"原料维度扣32分""收档检查469次"
 * 这类真实数据里根本不存在的具体数字。prompt里已经写了"绝对禁止编造数字"，
 * LLM还是编了——说明靠另一个LLM(合规审查)去抓这种问题不够可靠。
 *
 * 这里加一道确定性门槛：把计划文本里出现的"N分"/"N次"这类数字声称，
 * 跟storeHealth里真实存在的数字集合做比对，比对不上直接打回，不需要
 * 等LLM合规审查去猜。只识别这两种最容易被编造的模式，不追求覆盖全部
 * 数字表达（如"7天"这种截止日期、"1/2/3"这种priority不需要校验）。
 */

const CLAIM_PATTERN = /(\d+(?:\.\d+)?)\s*(分|次)/g;

function extractClaims(text) {
  const claims = [];
  if (!text) return claims;
  for (const m of String(text).matchAll(CLAIM_PATTERN)) {
    claims.push({ value: Number(m[1]), unit: m[2], raw: m[0] });
  }
  return claims;
}

/** 把 storeHealth 里所有可信数字摊平成一个集合，用于比对 */
export function flattenKnownNumbers(storeHealth = {}) {
  const nums = new Set();
  const add = v => {
    const n = Number(v);
    if (Number.isFinite(n)) nums.add(n);
  };

  add(storeHealth.healthScore);
  const bd = storeHealth.scoreBreakdown || {};
  add(bd.anomalyDeduct);
  add(bd.materialDeduct);
  add(bd.closingDeduct);
  add(bd.complaintDeduct);

  for (const a of storeHealth.anomalies || []) add(a.count);
  for (const m of storeHealth.materialIssues || []) add(m.count);

  add(storeHealth.inspections?.closingTotal);
  add(storeHealth.inspections?.closingPassed);
  add(storeHealth.complaints?.tableVisitTotal);
  add(storeHealth.complaints?.withComplaints);

  return nums;
}

/**
 * @param {{ rootCauses?: string[], summary?: string }} planData
 * @param {object} storeHealth
 * @returns {{ passed: boolean, unverifiedClaims: Array<{ raw: string, field: string }> }}
 */
export function checkPlanGrounding(planData, storeHealth) {
  const known = flattenKnownNumbers(storeHealth);
  const unverified = [];

  const fields = [
    ['summary', planData?.summary],
    ...(Array.isArray(planData?.rootCauses) ? planData.rootCauses.map((t, i) => [`rootCauses[${i}]`, t]) : []),
  ];

  for (const [field, text] of fields) {
    for (const claim of extractClaims(text)) {
      if (!known.has(claim.value)) {
        unverified.push({ raw: claim.raw, field });
      }
    }
  }

  return { passed: unverified.length === 0, unverifiedClaims: unverified };
}

/**
 * 通用版：任意一段LLM生成文本 + 一个"可信数字"集合，校验文本里的"N分"/"N次"声称
 * 是否都能在可信集合里找到依据。用于hq-planner-agent以外的其它LLM总结生成场景
 * （如A/B测试结果总结），复用同一条"确定性数字比对"防线，避免LLM在总结时编造。
 * @param {string} text
 * @param {Set<number>|number[]} knownNumbers
 * @returns {{ passed: boolean, unverifiedClaims: Array<{ raw: string, field: string }> }}
 */
export function checkTextGrounding(text, knownNumbers) {
  const known = knownNumbers instanceof Set ? knownNumbers : new Set(knownNumbers || []);
  const unverified = extractClaims(text)
    .filter(claim => !known.has(claim.value))
    .map(claim => ({ raw: claim.raw, field: 'text' }));
  return { passed: unverified.length === 0, unverifiedClaims: unverified };
}
