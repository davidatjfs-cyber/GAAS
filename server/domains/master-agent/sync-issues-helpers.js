/**
 * Pure skip rules for data_auditor → master_tasks sync (P4 peel).
 */

export const DISABLED_LEGACY_BI_CATEGORIES = [
  '实收营收异常',
  '人效值异常',
  '充值异常',
  '桌访产品异常',
  '桌访占比异常',
  '产品差评异常',
  '服务差评异常',
  '总实收毛利率异常',
];

/**
 * @param {{ category?: string, title?: string }} issue
 * @returns {'legacy_bi'|'material'|null}
 */
export function classifySkippedAuditorIssue(issue) {
  const cat = String(issue?.category || '');
  const ttl = String(issue?.title || '');
  if (DISABLED_LEGACY_BI_CATEGORIES.some((name) => cat.includes(name))) {
    return 'legacy_bi';
  }
  if (
    cat.includes('原料收货')
    || /近\s*\d+\s*天.*原料|条原料.*异常|原料异常反馈/i.test(ttl)
  ) {
    return 'material';
  }
  return null;
}
