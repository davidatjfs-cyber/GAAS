/**
 * LLM 辅助评估（2026-08-02）：用 L1 原则+上下文复核学员单句。
 * 规则引擎给初步判定；LLM 可纠正误判/补漏（推诿、过度承诺等），并给出教练旁白。
 * 输出非法或调用失败时，由调用方回退规则判定（本模块返回 ok:false）。
 */

import { CS_PRINCIPLES, SALES_PRINCIPLES } from './principles.js';

const PRINCIPLES_BY_TRACK = {
  cs: CS_PRINCIPLES,
  sales: SALES_PRINCIPLES,
};

/** 客观硬违规：规则命中即保留，LLM 宽松也不放掉 */
const HARD_VIOLATIONS = new Set(['dig_refund_root', 'own_problem', 'no_overpromise']);

/** 违规原则 → 引擎行为 code 与教练短句 */
const CODE_MESSAGES = {
  no_early_pitch: { code: 'early_pitch', message: '过早介绍产品，建议先挖需求' },
  sell_outcome: { code: 'feature_dump', message: '不卖功能，先问哪个经营结果最重要' },
  stay_on_pain: { code: 'price_defend', message: '别急着说不贵，先确认更担心价格还是效果' },
  no_argue: { code: 'arguing', message: '不争论：先承认对方有原因，再追问经历' },
  ask_first: { code: 'monologue', message: '讲太多：试试先请求问三个问题' },
  soothe_first: { code: 'no_soothe', message: '先安抚再处理，不要直接查问题' },
  empathy: { code: 'empty_calm', message: '少说「别着急」，多说「换我也会急，一起处理」' },
  ask_expectation: { code: 'ux_defend', message: '先问客户希望怎么操作' },
  dig_refund_root: { code: 'hard_deny', message: '先挖根因，再一起想办法' },
  own_problem: { code: 'blame_shift', message: '先揽责不推诿：承认客户处境，再说明你方会做什么' },
  no_overpromise: { code: 'overpromise', message: '承诺要可兑现：给具体动作和时间，别用「保证/绝对」' },
  closing: { code: 'soft_no_missed', message: '「再考虑」常是拒绝信号，请确认顾虑' },
};

function extractJson(raw) {
  let s = String(raw || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function cleanList(list, allowedIds) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x === 'object' && allowedIds.has(x.principle_id))
    .map((x) => ({ principle_id: x.principle_id, detail: String(x.detail || '').slice(0, 80) }))
    .slice(0, 3);
}

/**
 * @returns {Promise<{ok:boolean, violations?:Array, strengths?:Array, coach?:string}>}
 */
export async function maybeRefineEvaluationWithLLM(callLLM, {
  track = 'cs', traineeText = '', customerText = '',
  evalResult = null, turnNo = 1,
}) {
  if (typeof callLLM !== 'function') return { ok: false };
  const principles = PRINCIPLES_BY_TRACK[track];
  if (!principles) return { ok: false };
  try {
    const allowedIds = new Set(principles.map((p) => p.id));
    allowedIds.add('closing'); // 既有 strength 兼容
    const principleLines = principles.map((p) => `- ${p.id}（${p.label}）：${p.skill}`).join('\n');
    const ruleV = (evalResult?.violations || []).map((v) => `${v.principle_id}（${v.detail}）`).join('；') || '无';
    const ruleS = (evalResult?.strengths || []).map((s) => `${s.principle_id}（${s.detail}）`).join('；') || '无';
    const prompt = [
      '你是岗位陪练的评估教练，用 L1 原则评估学员「这一句」（只判这一句，不翻旧账）。',
      `轨道：${track === 'sales' ? '销售' : '客服'}`,
      `轮次：第 ${turnNo} 轮学员发言`,
      `原则（principle_id 只能从这些里选）：\n${principleLines}`,
      `客户上一句：${customerText || '（开场）'}`,
      `学员本句：${traineeText}`,
      `规则引擎初步判定——违规：${ruleV}；优点：${ruleS}`,
      '要求：',
      '1) 如果初步判定与上下文不符（例如客户语气平静、学员已回应其问题），可以删掉该判定，不要冤枉；',
      '2) 明显问题必须判：推诿甩锅（如「不是我们控制的」「不归我们管」）、过度承诺/空头承诺（如「保证绝对没问题」「100%」）、情绪场景不安抚、直接硬拒退款；',
      '3) 禁止翻旧账：上一轮或更早的问题不得算到本轮；本轮这句话本身没有违规，就不要写 violations；',
      '4) 学员做得好的点（回应了客户问题、给了时间/方案/闭环）要记为 strengths；',
      '5) coach 给一句话教练旁白（≤30字）：有违规就纠正，有优点就表扬，中性就给下一步建议，不要空话套话。',
      '只输出 JSON：{"violations":[{"principle_id":"","detail":""}],"strengths":[{"principle_id":"","detail":""}],"coach":""}',
    ].filter(Boolean).join('\n');

    const r = await callLLM(
      [{ role: 'user', content: prompt }],
      {
        purpose: 'talent_engine_turn_refine',
        temperature: 0.2,
        max_tokens: 300,
        skipCache: true,
        trackTier: true,
      }
    );
    const raw = String(r?.content || r?.text || '').trim();
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== 'object') return { ok: false };

    const violations = cleanList(parsed.violations, allowedIds);
    const strengths = cleanList(parsed.strengths, allowedIds);
    // 硬违规补回：规则命中且属于客观项，不允许 LLM 宽松放掉
    for (const v of evalResult?.violations || []) {
      if (HARD_VIOLATIONS.has(v.principle_id) && !violations.some((x) => x.principle_id === v.principle_id)) {
        violations.push({ principle_id: v.principle_id, detail: v.detail });
      }
    }
    return {
      ok: true,
      violations: violations.slice(0, 3),
      strengths: strengths.slice(0, 3),
      coach: String(parsed.coach || '').trim().slice(0, 60),
    };
  } catch (_) {
    return { ok: false };
  }
}

/**
 * 把 LLM 复核结果合并成最终 evalResult（保留规则 triggers/hasQuestion，
 * 违规 code 映射回引擎可识别标签，LLM 教练旁白优先展示）。
 */
export function applyRefinedEvaluation(ruleEval, refined) {
  const violations = refined.violations || [];
  const strengths = refined.strengths || [];
  const coach = refined.coach || '';
  const coachTags = [];
  for (const v of violations.slice(0, 2)) {
    const cm = CODE_MESSAGES[v.principle_id];
    if (cm) coachTags.push({ code: cm.code, level: 'error', message: cm.message });
  }
  if (coach && !coachTags.some((t) => t.message === coach)) {
    coachTags.push({
      code: 'llm_coach',
      level: violations.length ? 'error' : strengths.length ? 'good' : 'info',
      message: coach,
    });
  }
  if (!coachTags.length) coachTags.push(...(ruleEval.coachTags || []));
  return {
    violations,
    strengths,
    coachTags,
    triggers: ruleEval.triggers || [],
    hasQuestion: !!ruleEval.hasQuestion,
  };
}
