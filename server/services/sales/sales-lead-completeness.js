/**
 * 门店信息收集完整性：AI对话抽取(extractSlotsFromText，尽力而为的正则匹配)和销售手工建档
 * 表单(POST /api/admin/sales/customers，强校验)是两条并行入口，之前没有统一的"信息是否收全"
 * 判断——AI对话路径即使信息不全也可能被判定为"已进入qualified阶段"。这里提供唯一的判断口径，
 * 两条入口都调用同一份逻辑，不再各自为政。
 */
const REQUIRED_FIELDS = [
  { key: 'store_count', label: '门店数量' },
  { key: 'pos_brand', label: 'POS品牌' },
  { key: 'phone_data_ready', label: '手机号数据情况' },
  { key: 'decision_role', label: '对接人决策角色' },
];

export function checkLeadCompleteness(lead) {
  const missing = [];
  for (const f of REQUIRED_FIELDS) {
    const v = lead?.[f.key];
    const ok = f.key === 'phone_data_ready' ? v === true : v != null && String(v).trim() !== '';
    if (!ok) missing.push(f.label);
  }
  return { complete: missing.length === 0, missing };
}

/** 需要"信息收全"才允许进入的阶段——早于这些阶段(如need_identified)不受限，销售仍可正常跟进对话。 */
export const STAGES_REQUIRING_COMPLETE_INFO = new Set([
  'qualified', 'sales_takeover', 'need_confirmed', 'profiling', 'diagnosed',
  'demo_requested', 'demo_scheduled', 'proposal', 'trial', 'won',
]);
