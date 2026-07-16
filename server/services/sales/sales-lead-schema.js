/** 客户画像唯一槽位Schema。extracted JSONB 保留历史别名，读取和新写入统一走本文件。 */
export const CUSTOMER_PROFILE_SLOTS = Object.freeze([
  { key: 'store_count', label: '门店数量', type: 'number', required: true, ask_order: 10, aliases: [], sensitive: false, used_for_scoring: true, used_for_diagnosis: true },
  { key: 'city', label: '城市', type: 'string', required: true, ask_order: 15, aliases: [], sensitive: false, used_for_scoring: false, used_for_diagnosis: true },
  { key: 'cuisine', label: '品类', type: 'string', required: true, ask_order: 20, aliases: ['category'], sensitive: false, used_for_scoring: false, used_for_diagnosis: true },
  { key: 'pos_brand', label: 'POS品牌', type: 'string', required: true, ask_order: 30, aliases: [], sensitive: false, used_for_scoring: true, used_for_diagnosis: true },
  { key: 'phone_data_ready', label: '手机号数据条件', type: 'boolean', required: true, ask_order: 40, aliases: ['phone_data_status'], sensitive: false, used_for_scoring: true, used_for_diagnosis: true },
  { key: 'member_estimate', label: '会员规模', type: 'number', required: true, ask_order: 45, aliases: ['member_count'], sensitive: false, used_for_scoring: true, used_for_diagnosis: true },
  { key: 'other_system_used', label: '其他系统', type: 'boolean', required: true, ask_order: 47, aliases: ['current_system'], sensitive: false, used_for_scoring: true, used_for_diagnosis: true },
  { key: 'pain_point', label: '核心痛点', type: 'string', required: true, ask_order: 50, aliases: ['primary_pain'], sensitive: false, used_for_scoring: true, used_for_diagnosis: true },
  { key: 'contact_phone', label: '联系人手机号', type: 'string', required: false, ask_order: 55, aliases: ['phone', 'contact'], sensitive: true, used_for_scoring: false, used_for_diagnosis: false },
  { key: 'decision_role', label: '决策角色', type: 'string', required: true, ask_order: 60, aliases: [], sensitive: false, used_for_scoring: true, used_for_diagnosis: true },
]);
export const CUSTOMER_PROFILE_SLOT_KEYS = Object.freeze(CUSTOMER_PROFILE_SLOTS.map((x) => x.key));
export const MINIMUM_DIAGNOSIS_FIELDS = Object.freeze(['store_count', 'pain_point', 'phone_data_ready']);
export const QUALIFIED_LEAD_FIELDS = Object.freeze(['store_count', 'city', 'pain_point', 'phone_data_ready', 'decision_role']);
export const OPTIONAL_PROFILE_FIELDS = Object.freeze(['contact_phone', 'member_estimate']);

export function normalizeCustomerProfileSlots(input = {}) {
  const out = { ...input };
  for (const slot of CUSTOMER_PROFILE_SLOTS) {
    if (out[slot.key] != null) continue;
    const alias = slot.aliases.find((key) => out[key] != null);
    if (alias) out[slot.key] = out[alias];
  }
  // 旧评分逻辑仍读取该派生值，保留兼容输出但不再把它当成独立槽位。
  if (out.other_system_used != null && out.has_member_system == null) out.has_member_system = out.other_system_used;
  if (out.contact_phone && !out.phone) out.phone = out.contact_phone;
  return out;
}
