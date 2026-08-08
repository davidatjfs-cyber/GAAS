/**
 * 会话评分（v1）：
 * 规则层：关键原则一票否决 + 模糊事实检测；
 * LLM 裁判层：7 维结构化打分（无 LLM 时用启发式兜底）；
 * 升级规则：当前级内 训练≥10 且 成功≥7 → 升级并重新计次。
 */

import { COACH_CRITICAL_PRINCIPLES, COACH_DIMENSIONS } from './coach-scripts.js';

export function scanViolations(transcript) {
  const violations = [];
  const text = (transcript || []).map((t) => `${t.role}:${t.text}`).join('\n');
  for (const p of COACH_CRITICAL_PRINCIPLES) {
    if (p.anti && p.anti.test(text)) {
      violations.push({ principle: p.id, label: p.label, fix: p.fix || '', rule: String(p.anti) });
    }
  }
  return violations;
}

export function heuristicScores(transcript, skillKey) {
  const trainee = (transcript || []).filter((t) => t.role === 'trainee').map((t) => String(t.text || ''));
  const joined = trainee.join('。');
  const dims = {};
  for (const d of COACH_DIMENSIONS) {
    if (d.skills && !d.skills.includes(skillKey)) continue;
    let s = 70;
    const len = joined.length;
    if (len >= 40) s += 8;
    if (len >= 15 && len < 40) s += 4;
    if (/\d+\s*(元|分钟)|会员|充值|送/.test(joined)) s += 6;
    if (/(请问|您|我帮您|建议|可以)/.test(joined)) s += 6;
    if (/（|）|。。。|？？/.test(joined)) s -= 4;
    dims[d.key] = Math.max(20, Math.min(100, s));
  }
  return dims;
}

export function computeTotal(scores) {
  const vals = Object.values(scores || {});
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function evalSession({ transcript, skillKey, scores = null, violations = [] }) {
  const finalViolations = violations.length ? violations : scanViolations(transcript);
  const rawDims = scores || heuristicScores(transcript, skillKey);
  const dims = {};
  const suggestions = [];
  for (const d of COACH_DIMENSIONS) {
    if (d.skills && !d.skills.includes(skillKey)) continue;
    const v = rawDims[d.key] ?? rawDims[d.label];
    if (v == null) continue;
    dims[d.label] = v;
    if (v < 80 && d.fix) {
      suggestions.push({ key: d.key, label: d.label, score: v, fix: d.fix });
    }
  }
  const total = computeTotal(dims);
  const success = finalViolations.length === 0 && total >= 80;
  for (const v of finalViolations) {
    suggestions.push({ key: v.principle, label: v.label, fix: v.fix || '对照关键原则改进', violation: true });
  }
  return { total, dims, violations: finalViolations, success, suggestions };
}

export function nextLevel(level) {
  if (level === 'normal') return 'advanced';
  if (level === 'advanced') return 'gold';
  return 'gold';
}

export function evaluateUpgrade(row) {
  const trained = Number(row?.trained_count || 0);
  const success = Number(row?.success_count || 0);
  if (trained >= 10 && success >= 7) {
    return { upgrade: true, next_level: nextLevel(row?.level || 'normal') };
  }
  return { upgrade: false };
}
