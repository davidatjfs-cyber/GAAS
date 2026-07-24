export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function clampLimit(raw, fallback = 50, max = 500) {
  return Math.min(Math.max(Number(raw) || fallback, 1), max);
}

export function clampOffset(raw) {
  return Math.max(Number(raw) || 0, 0);
}

/** Keyword fallback when agents semantic-parse is unavailable. */
export function parseSemanticFallback(text) {
  const tags = [];
  if (/辣|麻辣/.test(text)) tags.push('麻辣');
  if (/清淡|少油/.test(text)) tags.push('清淡');
  if (/甜|甜品/.test(text)) tags.push('甜品');
  if (/肉|牛|羊|猪/.test(text)) tags.push('肉食');
  if (/汤|煲/.test(text)) tags.push('汤品');
  return {
    ok: true,
    taste_tags: tags,
    price_sensitivity: null,
    emotion: /差|不好|失望/.test(text) ? '负面' : /好|好吃|满意/.test(text) ? '正面' : '中性',
    return_intent: /再来|下次|还会/.test(text),
    key_insight: '关键词解析（LLM不可用）',
    source: 'keyword_fallback',
  };
}

/**
 * Build WHERE clause + params from optional equality filters.
 * @param {Array<[string, string]>} filters [sqlExpr, value] — empty value skipped
 */
export function buildWhere(filters) {
  const conditions = [];
  const params = [];
  let idx = 1;
  for (const [expr, value] of filters) {
    if (!value) continue;
    // expr may contain $N placeholder(s) that all bind the same value (e.g. store OR)
    if (expr.includes('$N')) {
      conditions.push(expr.replaceAll('$N', `$${idx}`));
      params.push(value);
      idx++;
    } else {
      conditions.push(`${expr} = $${idx++}`);
      params.push(value);
    }
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return { where, params, nextIdx: idx };
}
