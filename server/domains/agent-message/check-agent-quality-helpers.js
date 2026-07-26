/**
 * Check Agent quality-gate pure helpers (P2 peel from agents.js).
 */
import { detectFactDemand } from './quality-helpers.js';

export function normalizePlainText(text, maxLen = 1200) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

export function safeJsonParse(text, fallback = null) {
  const raw = String(text || '').trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* ignore */
  }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    return JSON.parse(m[0]);
  } catch {
    return fallback;
  }
}

export function extractNumericLiterals(text) {
  const vals = String(text || '').match(/-?\d+(?:\.\d+)?%?/g) || [];
  return vals.slice(0, 24);
}

export function verifyNumericGrounding(responseText, evidenceText) {
  const answerNums = extractNumericLiterals(responseText);
  if (!answerNums.length) return { ok: true, missing: [] };
  const evidenceNums = new Set(extractNumericLiterals(evidenceText));
  if (!evidenceNums.size) return { ok: false, missing: answerNums.slice(0, 6) };
  const missing = answerNums.filter((x) => !evidenceNums.has(x));
  return {
    ok: missing.length <= Math.max(1, Math.floor(answerNums.length * 0.3)),
    missing: missing.slice(0, 6),
  };
}

export function fallbackQualityAudit(userQuery, agentResponse) {
  const q = normalizePlainText(userQuery || '', 300);
  const a = normalizePlainText(agentResponse || '', 1200);
  let accuracy = 6;
  let relevance = 6;
  let tone = 7;

  if (!a) {
    return {
      accuracy: 2,
      relevance: 2,
      tone: 5,
      total: 3,
      pass: false,
      feedback: '回答为空，请直接回答用户问题并给出可执行下一步。',
    };
  }

  if (a.length < 20) relevance -= 2;
  if (/抱歉|稍后|无法|不清楚/.test(a) && /(多少|排名|趋势|分析|绩效|SOP)/.test(q)) relevance -= 2;
  if (/不知道|随便|你看着办/.test(a)) tone -= 3;
  if (/\d/.test(q) && !/\d/.test(a) && detectFactDemand(q) === 'hard') accuracy -= 2;

  const total = Number(((accuracy + relevance + tone) / 3).toFixed(1));
  return {
    accuracy,
    relevance,
    tone,
    total,
    pass: total >= 7,
    feedback: total >= 7 ? '' : '请更贴合问题、补充关键事实或明确说明缺失数据来源。',
  };
}

export function normalizeLlmAuditResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const total = Number(parsed.total);
  return {
    accuracy: Number(parsed.accuracy) || 0,
    relevance: Number(parsed.relevance) || 0,
    tone: Number(parsed.tone) || 0,
    total: Number.isFinite(total)
      ? total
      : Number(
          (
            ((Number(parsed.accuracy) || 0) + (Number(parsed.relevance) || 0) + (Number(parsed.tone) || 0)) /
            3
          ).toFixed(1)
        ),
    pass: parsed.pass !== false,
    feedback: String(parsed.feedback || '').trim(),
  };
}
