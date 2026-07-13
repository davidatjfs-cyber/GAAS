/**
 * 客户标签体系（规则可追溯，非黑盒）：基础标签 + 需求标签 + 销售标签
 */
const TAG_RULES = [
  // 基础标签
  { key: 'single_store', label: '单店客户', test: (l) => l.store_count === 1 },
  { key: 'chain_store', label: '连锁客户', test: (l) => (l.store_count || 0) >= 2 },
  { key: 'has_pos_data', label: '有POS数据', test: (l) => l.phone_data_ready === true },
  { key: 'no_data_base', label: '无数据基础', test: (l) => l.phone_data_ready === false },

  // 需求标签（按 pain_point 现有 3 类映射）
  { key: 'low_repurchase', label: '老客复购低', test: (l) => /复购|老客|流失/.test(String(l.pain_point || '')) },
  { key: 'execution_weak', label: '店长执行弱', test: (l) => /执行|店长/.test(String(l.pain_point || '')) },
  { key: 'talent_training_needed', label: '人才培养待提升', test: (l) => /培训|人才|培养/.test(String(l.pain_point || '')) },

  // 销售标签（按 stage / intent_level 派生）
  { key: 'high_intent', label: '高意向', test: (l) => l.intent_level === 'high' },
  { key: 'clear_need', label: '有明确需求', test: (l) => l.intent_level !== 'high' && !!l.pain_point },
  { key: 'initial_contact', label: '初步了解', test: (l) => ['new', 'ai_greeting'].includes(l.stage) && !l.pain_point },
  { key: 'on_hold', label: '暂缓', test: (l) => ['lost', 'unfit'].includes(l.stage) },
];

/**
 * 输入线索当前字段状态，输出标签数组。
 * @param {{ store_count?: number, phone_data_ready?: boolean, pain_point?: string, stage?: string, intent_level?: string }} lead
 * @returns {string[]}
 */
export function deriveTagsForLead(lead = {}) {
  return TAG_RULES.filter((rule) => rule.test(lead)).map((rule) => rule.label);
}
