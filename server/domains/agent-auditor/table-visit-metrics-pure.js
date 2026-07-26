/**
 * Table-visit dissatisfaction pure helpers (P2 peel from agents.js).
 * Aligned with agents-service-v2 tableVisitEntryIsDissatisfied semantics.
 */

/** 与 agents-service-v2 tableVisitReasonImpliesDissatisfaction 同源（HRMS 侧不落 npm 依赖） */
export function tableVisitReasonImpliesDissatisfactionHrms(text) {
  const t = String(text || '').trim();
  if (t.length < 2) return false;
  if (/很满意|非常满意|太满意|十分满意/.test(t) && !/不满意|不好|太|不够|没|糊|冷|少|骨头|差评|失望|投诉|还行|一般/.test(t)) {
    return false;
  }
  if (
    /不满意|不好|不太满意|不够满意|很差|糟糕|差劲|一般般|较差|糊味|糊了|不怎么热|不热|太冷|骨头太多|没肉|量少|差评|失望|投诉|太少|太多骨头|有骨头|量太少/.test(
      t
    )
  ) {
    return true;
  }
  return false;
}

/**
 * 桌访一行是否计为「不满意」（与 agents-service-v2 tableVisitEntryIsDissatisfied 同源）：
 * - 满意度明确为好 → 否
 * - 满意度明确为差 → 有不满意菜品 或 有主要原因/反馈
 * - 其它 → 须同时有不满意菜品 + 有意义的主要原因（对齐「今天不满意的菜品」「不满意的主要原因是什么」）
 */
export function tableVisitRowIsDissatisfied(row) {
  const sat = String(row?.satisfaction_level || '').trim();
  if (sat && /满意|挺好的|挺好|很好|不错|好|赞|^是$/i.test(sat) && !/不满意|很差|糟糕/.test(sat)) return false;

  const dishes = extractTableVisitDishes(row);
  const reason = String(row?.unsatisfied_items || row?.feedback || '').trim();
  const reasonMeaningful =
    reason.length >= 2 && !/^(无|没有|暂无|不详|未知|-|—|你好|谢谢|ok|OK)$/i.test(reason);

  if (sat && /不满意|不好|不太满意|不够满意|很差|糟糕|差劲|较差|^否$/i.test(sat)) {
    return dishes.length > 0 || reasonMeaningful;
  }

  if (!sat && tableVisitReasonImpliesDissatisfactionHrms(reason) && dishes.length > 0) return true;

  return dishes.length > 0 && reasonMeaningful;
}

export function extractTableVisitSatisfactionFromFields(fields, extractBitableFieldText) {
  const candidates = [
    fields['用餐满意度'],
    fields['今天用餐满意度'],
    fields['今天用餐是否满意'],
    fields['满意度等级'],
    fields['满意度'],
  ];
  for (const v of candidates) {
    const text = extractBitableFieldText(v);
    if (text) return text;
  }
  return '';
}

export function extractTableVisitDishes(row) {
  const raw = String(row?.dissatisfaction_dish || '').trim();
  if (!raw) return [];
  const blocked = new Set(['无', '没有', '暂无', '无菜品', '不清楚', '未知', '其他']);
  return raw
    .split(/[，,、\/;；|\n\r\t\s]+/)
    .map((k) => String(k || '').trim())
    .filter((k) => k && !blocked.has(k));
}

