export function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export const VALID_PAYMENT_TAGS = new Set([
  'prospect',
  'new',
  'active',
  'at_risk',
  'dormant',
  'churned',
  'vip',
  'regular',
  'low',
  'general',
]);

export function normalizePaymentTags(input) {
  let arr = [];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === 'string' && input) arr = [input];
  return arr.map((t) => String(t).trim()).filter((t) => VALID_PAYMENT_TAGS.has(t));
}

export function paymentRuleToSync(row) {
  return {
    rule_key: row.rule_key,
    store_id: row.store_id,
    name: row.name,
    priority: row.priority,
    trigger_type: 'payment',
    action_type: 'send_voucher',
    action_config: { template_id: row.member_template_id || '' },
    target_tags: Array.isArray(row.target_tags) ? row.target_tags : [],
    trigger_value: row.trigger_value == null ? '' : String(row.trigger_value),
    daily_user_limit: row.daily_user_limit == null ? null : Number(row.daily_user_limit),
    global_daily_limit: row.global_daily_limit == null ? null : Number(row.global_daily_limit),
  };
}

export function parseOptionalNonNegInt(value) {
  if (value === '' || value == null) return null;
  return Math.max(0, Math.floor(Number(value) || 0));
}
