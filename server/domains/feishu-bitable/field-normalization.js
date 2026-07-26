/**
 * 飞书多维表格字段归一化（P2 peel from agents.js）。
 * 纯同步函数，无 SQL / HTTP / 可变全局状态。
 */

function toDateOnly(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  try {
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

export function normalizeBitableDateValue(v, fallback = '') {
  if (v === null || v === undefined || v === '') return toDateOnly(fallback);
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000;
    return toDateOnly(new Date(ms).toISOString());
  }
  const s = String(v || '').trim();
  if (!s) return toDateOnly(fallback);
  if (/^\d{13}$/.test(s) || /^\d{10}$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) {
      const ms = s.length === 13 ? n : n * 1000;
      return toDateOnly(new Date(ms).toISOString());
    }
  }
  return toDateOnly(s) || toDateOnly(fallback);
}

/** 支持 string / [{text_arr}] / [{text}] / object.text / number */
export function extractBitableFieldText(val) {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  if (Array.isArray(val)) {
    const parts = [];
    for (const item of val) {
      if (typeof item === 'string') { parts.push(item); continue; }
      if (item && typeof item === 'object') {
        if (Array.isArray(item.text_arr) && item.text_arr.length) {
          parts.push(...item.text_arr.map((t) => String(t || '').trim()).filter(Boolean));
        } else if (item.text) {
          parts.push(String(item.text).trim());
        }
      }
    }
    return parts.join('，').trim();
  }
  if (typeof val === 'object' && val.text) return String(val.text).trim();
  return String(val).trim();
}

export function extractDissatisfactionDishFromFields(fields) {
  const candidates = [
    fields['今天不满意的菜品'],
    fields['今天 不满意菜品'],
    fields['今天不满意菜品'],
    fields['今日不满意菜品'],
    fields['不满意菜品'],
    fields['不满意菜品/问题'],
  ];
  for (const v of candidates) {
    const text = extractBitableFieldText(v);
    if (text) return text;
  }
  return '';
}

export function extractDissatisfactionReasonFromFields(fields) {
  const candidates = [
    fields['不满意的主要原因是什么'],
    fields['不满意的主要原因'],
    fields['满意/不满意的主要原因'],
    fields['满意或不满意的主要原因是什么？'],
    fields['满意或不满意的主要原因'],
    fields['不满意项'],
    fields['不满意原因'],
    fields['备注'],
  ];
  for (const v of candidates) {
    const text = extractBitableFieldText(v);
    if (text) return text;
  }
  return '';
}

export function extractTableVisitItems(row) {
  const dishText = String(row?.dissatisfaction_dish || '').trim();
  const _reasonText = String(row?.unsatisfied_items || '').trim();

  const dishItems = dishText
    ? dishText
        .split(/[，,、\/;；|\n\r\t\s]+/)
        .map((k) => String(k || '').trim())
        .filter(Boolean)
    : [];

  // 只用 dissatisfaction_dish 统计产品投诉；unsatisfied_items 是原因描述不是菜品名
  return dishItems.filter((x) => x && !/卤鹅/.test(String(x)));
}
